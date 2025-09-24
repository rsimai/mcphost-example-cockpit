import React, { useState, useRef, useEffect } from 'react';
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const Application = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [process, setProcess] = useState(null);
  const outputRef = useRef(null);

  useEffect(() => {
    const proc = cockpit.spawn(
      ['./main', '--model', 'ollama:qwen2.5:3b','-debug','-log-file','/tmp/mcp-go-debug.log'],
      {
        directory: '/home/robert/git/mcphost-example-cockpit',
        err: 'ignore' // Ignore stderr, as we can only have one stream handler.
      }
    );
    setProcess(proc);

    let stdoutBuffer = '';
    const handleMessage = (msg) => {
      // Only display the content from 'chunk' messages for a clean UI.
      if (msg.msg_type === 'chunk') {
        setOutput(prev => prev + msg.content);
      }
      // Other message types like 'ready' are received but not shown.
    };

    // This single stream handler processes stdout, which carries the JSON messages.
    proc.stream(data => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || ''; // Keep any incomplete line in the buffer.

      lines.forEach(line => {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            handleMessage(msg);
          } catch (e) {
            // Don't display invalid JSON, just log it for debugging.
            console.warn("Received non-JSON stdout line:", line);
          }
        }
      });
    });

    // Cleanup function to run when the component unmounts.
    return () => {
      proc.close();
    };
  }, []); // The empty dependency array ensures this effect runs only once

  // Auto-scroll effect for the output area
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const sendMessage = () => {
    // Ensure there is input to send and the process is running
    if (!input.trim() || !process) return;

    const userInput = input.trim();

    // Construct the message object with the correct type and content
    const msg = {
      msg_type: 'prompt',
      content: userInput
    };

    // Stringify the message and add a newline for the backend to read
    const jsonMsg = JSON.stringify(msg) + '\n';

    setOutput(prev => prev + `\n> ${userInput}\n`);

    // Write the JSON message to the process's standard input (stdin)
    process.input(jsonMsg);
    setInput('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h1">{_("Local MCP")}</Title>
      </StackItem>
      <StackItem>
        <Flex>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              value={input}
              onChange={(_, value) => setInput(value)}
              onKeyPress={handleKeyPress}
              placeholder={_("Enter your message...")}
            />
          </FlexItem>
          <FlexItem>
            <Button onClick={sendMessage} disabled={!process}>{_("Send")}</Button>
          </FlexItem>
        </Flex>
      </StackItem>
      <StackItem isFilled>
        <TextArea
          ref={outputRef}
          value={output}
          readOnly
          style={{ fontFamily: 'monospace', height: 'calc(100vh - 200px)', minHeight: '400px' }}
          placeholder={_("Output will appear here...")}
        />
      </StackItem>
    </Stack>
  );
};