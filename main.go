package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/mark3labs/mcphost/sdk"
)

var (
	model        = flag.String("model", "", "Model to use, e.g. ollama:qwen2.5:3b")
	configFile   = flag.String("config-file", "mcphost.json", "Path to mcphost configuration")
	systemPrompt = flag.String("system-prompt", "", "Set the system prompt. Defaults to the model's if not set")
	debug        = flag.Bool("debug", false, "Enable debug logging")
	logFile      = flag.String("log-file", "", "Write logs to this file. Will be truncated. Defaults to stderr if not set")
)

const (
	msgTypeReady          = "ready"                // inform remote that we are ready for a prompt
	msgTypePrompt         = "prompt"               // remote is sending a prompt message
	msgTypeQuit           = "quit"                 // remote is sending a quit message
	msgTypeChunk          = "chunk"                // a chunk in a streaming response to remote
	msgTypeConfirm        = "confirm-tool-run"     // ask remote for permission to run a tool
	msgTypeAllow          = "allow-tool-run"       // remote gives permission to run tool
	msgTypeDeny           = "deny-tool-run"        // remote denies permission to run tool
	msgTypeResultOK       = "tool-result-ok"       // inform remote that the tool ran okay
	msgTypeResultFailed   = "tool-result-failed"   // inform remote that the tool run failed
	msgTypeResultCanceled = "tool-result-canceled" // inform remote that the tool call was canceled
)

type Message struct {
	MsgType string `json:"msg_type"`
	Content string `json:"content"`
}

func (m Message) String() string {
	s := "MsgType: " + m.MsgType
	if m.Content != "" {
		s += ", Content: " + m.Content
	}
	return s
}

func recvMessage(scanner *bufio.Scanner) (Message, error) {
	msg := Message{}
	if !scanner.Scan() {
		return msg, scanner.Err()
	}
	b := scanner.Bytes()
	err := json.Unmarshal(b, &msg)
	if err == nil {
		slog.Debug("received from stdin", "Message", msg)
	}
	return msg, err
}

func sendMessage(w io.Writer, msg Message) error {
	slog.Debug("sending to stdout", "Message", msg)
	return json.NewEncoder(w).Encode(msg) // appends a newline
}

func main() {
	flag.Parse()
	if *model == "" {
		fmt.Fprintf(os.Stderr, "Model must be set.\n")
		flag.Usage()
		os.Exit(1)
	}
	if *debug {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}
	if *logFile != "" {
		f, err := os.Create(*logFile)
		if err != nil {
			slog.Warn("Cannot create", "logFile", *logFile, "error", err)
			slog.Info("Using stderr for logging")
		} else {
			defer f.Close()
			logLevel := slog.LevelInfo
			if *debug {
				logLevel = slog.LevelDebug
			}
			logger := slog.New(slog.NewTextHandler(f, &slog.HandlerOptions{Level: logLevel}))
			slog.SetDefault(logger)
		}
	}

	options := sdk.Options{
		Model:        *model,
		ConfigFile:   *configFile,
		SystemPrompt: *systemPrompt,
		Streaming:    true,
		Quiet:        true,
	}
	slog.Debug("sdk config", "options", options)

	ctx, cancel := context.WithCancel(context.Background())
	host, err := sdk.New(ctx, &options)
	if err != nil {
		slog.Error("creating MCPHost", "error", err)
		os.Exit(1)
	}

	err = chatLoop(ctx, host)
	if err != nil {
		slog.Error("chatLoop", "error", err)
		cancel()
		os.Exit(1)
	}
}

func chatLoop(ctx context.Context, host *sdk.MCPHost) error {
	defer host.Close()

	scanner := bufio.NewScanner(os.Stdin)

	for {
		err := sendMessage(os.Stdout, Message{MsgType: msgTypeReady})
		if err != nil {
			return err
		}

		msg, err := recvMessage(scanner)
		if err != nil {
			return err
		}
		switch msg.MsgType {
		case msgTypeQuit:
			return nil
		case msgTypePrompt:
			err = handlePrompt(ctx, msg.Content, host, scanner)
			if err != nil {
				return err
			}
		default:
			slog.Warn("expected prompt or quit, got", "MsgType", msg.MsgType)
		}
	}
}

func handlePrompt(ctx context.Context, prompt string, host *sdk.MCPHost, scanner *bufio.Scanner) error {
	promptCanceled := false
	promptCtx, cancelPrompt := context.WithCancel(ctx)

	_, err := host.PromptWithCallbacks(
		promptCtx,
		prompt,
		func(name, args string) { // onToolCall callback
			details := fmt.Sprintf("Run tool: %s with args: %s", name, args)
			err := sendMessage(os.Stdout, Message{MsgType: msgTypeConfirm, Content: details})
			if err != nil {
				slog.Error("onToolcall: sending message", "err", err)
			}
			msg, err := recvMessage(scanner)
			if err != nil {
				slog.Error("onToolCall: receiving message", "err", err)
			}
			switch msg.MsgType {
			case msgTypeDeny:
				promptCanceled = true
				cancelPrompt()
			case msgTypeAllow:
				return
			default:
				slog.Warn("onToolCall: expected allow or deny, got:", "MsgType", msg.MsgType)
			}
		},
		func(name, args, result string, isError bool) { // onToolResult callback
			if isError {
				err := sendMessage(os.Stdout, Message{MsgType: msgTypeResultFailed, Content: name})
				if err != nil {
					slog.Error("onToolResult: sending message", "err", err)
				}
				return
			}
			if errors.Is(promptCtx.Err(), context.Canceled) {
				err := sendMessage(os.Stdout, Message{MsgType: msgTypeResultCanceled, Content: name})
				if err != nil {
					slog.Error("onToolResult: sending message", "err", err)
				}
				return
			}
			err := sendMessage(os.Stdout, Message{MsgType: msgTypeResultOK, Content: name})
			if err != nil {
				slog.Error("onToolResult: sending message", "err", err)
			}
		},
		func(chunk string) { // onStreaming callback
			err := sendMessage(os.Stdout, Message{MsgType: msgTypeChunk, Content: chunk})
			if err != nil {
				slog.Error("onStreaming: sending message", "err", err)
			}
		})
	if err != nil && !promptCanceled {
		return err
	}
	return nil
}
