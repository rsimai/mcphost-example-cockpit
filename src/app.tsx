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
  const [isReady, setIsReady] = useState(false);
  const [toolRequest, setToolRequest] = useState(null);
  const outputRef = useRef(null);

  useEffect(() => {
    const proc = cockpit.spawn(['./main', '--model', 'ollama:qwen2.5:3b', '--debug', '--log-file', '/tmp/mcp-go-debug.log'], {
      directory: '/home/robert/git/mcphost-example-cockpit',
      err: 'message'
    });
    
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let readyCount = 0;
    
    const handleMessage = (msg) => {
      if (msg.msg_type === 'ready') {
        setIsReady(true);
      } else if (msg.msg_type === 'chunk') {
        setOutput(prev => prev + msg.content);
      } else if (msg.msg_type === 'confirm-tool-run') {
        setOutput(prev => prev + '\n[TOOL REQUEST] ' + msg.content + '\n');
        setToolRequest(msg.content);
      } else if (msg.msg_type === 'tool-result-ok') {
        setOutput(prev => prev + '[TOOL OK] ' + msg.content + '\n');
      } else if (msg.msg_type === 'tool-result-failed') {
        setOutput(prev => prev + '[TOOL FAILED] ' + msg.content + '\n');
      } else if (msg.msg_type === 'tool-result-canceled') {
        setOutput(prev => prev + '[TOOL CANCELED] ' + msg.content + '\n');
      }
    };
    
    proc.stream(data => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            handleMessage(msg);
          } catch (e) {
            // Ignore non-JSON stdout
          }
        }
      });
    });
    
    proc.stream(data => {
      stderrBuffer += data;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            handleMessage(msg);
          } catch (e) {
            // Ignore non-JSON stderr
          }
        }
      });
    }, 'err');
    
    proc.fail(() => {
      setIsReady(false);
    });
    
    proc.done(() => {
      setIsReady(false);
    });
    
    const handleBeforeUnload = () => {
      if (proc) {
        try {
          const quitMsg = JSON.stringify({ msg_type: 'quit', content: '' }) + '\n';
          proc.input(quitMsg, false);
        } catch (e) {
          // Ignore errors during cleanup
        }
        proc.close();
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    setProcess(proc);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (proc) {
        try {
          const quitMsg = JSON.stringify({ msg_type: 'quit', content: '' }) + '\n';
          proc.input(quitMsg, false);
        } catch (e) {
          // Ignore errors during cleanup
        }
        proc.close();
      }
    };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const sendMessage = () => {
    if (input.trim() && process && isReady) {
      const msg = { msg_type: 'prompt', content: input.trim() };
      const jsonMsg = JSON.stringify(msg) + '\n';
      
      setOutput(prev => prev + '\n> ' + input.trim() + '\n');
      process.input(jsonMsg, false);
      setInput('');
      setIsReady(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const handleToolResponse = (allow) => {
    if (process && toolRequest) {
      const msgType = allow ? 'allow-tool-run' : 'deny-tool-run';
      const msg = JSON.stringify({ msg_type: msgType, content: '' }) + '\n';

      process.input(msg, false);
      setOutput(prev => prev + '[' + (allow ? 'ALLOWED' : 'DENIED') + '] Tool execution\n');
      setToolRequest(null);
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
            <Button onClick={sendMessage} isDisabled={!isReady}>{_("Send")}</Button>
          </FlexItem>
        </Flex>
      </StackItem>
      {toolRequest && (
        <StackItem>
          <Flex>
            <FlexItem>
              <span>{_("Allow tool execution?")}</span>
            </FlexItem>
            <FlexItem>
              <Button variant="primary" onClick={() => handleToolResponse(true)}>{_("Yes")}</Button>
            </FlexItem>
            <FlexItem>
              <Button variant="secondary" onClick={() => handleToolResponse(false)}>{_("No")}</Button>
            </FlexItem>
          </Flex>
        </StackItem>
      )}
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