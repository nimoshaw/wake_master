# WakeMaster Agent Integration

WakeMaster can be used by AI coding assistants and IDEs through two interfaces:

## 1. CLI Tool

```bash
# Direct usage
node agent/cli.js list
node agent/cli.js status
node agent/cli.js wake station
node agent/cli.js add my-server D8:BB:C1:9A:9D:79 192.168.0.100
node agent/cli.js remove my-server

# JSON output for agents
WAKE_MASTER_JSON=1 node agent/cli.js status
```

## 2. MCP Server (for AI Coding Assistants)

Add to your IDE's MCP configuration:

### Cursor / Claude Desktop
```json
{
  "mcpServers": {
    "wake-master": {
      "command": "node",
      "args": ["/path/to/wake_master/agent/mcp-server.js"]
    }
  }
}
```

### Available MCP Tools
| Tool | Description |
|------|-------------|
| `wake_master_list` | List all managed machines |
| `wake_master_status` | Check online/offline status |
| `wake_master_wake` | Send WOL packet to wake a machine |
| `wake_master_add` | Add a new machine |
| `wake_master_remove` | Remove a machine |

### Example Agent Usage
Your AI assistant can now say:
> "Let me check if your machines are online... [calls wake_master_status]
> station is offline. Want me to wake it up? [calls wake_master_wake with machine='station']"
