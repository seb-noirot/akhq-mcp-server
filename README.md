# AKHQ MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for [AKHQ](https://akhq.io) — the GUI for Apache Kafka.

Enables AI assistants (Claude, Cursor, etc.) to interact with Kafka clusters through AKHQ's REST API.

## Features

- **Multi-environment support** — configure multiple AKHQ instances (dev, staging, prod) and switch between them at runtime
- **Flexible authentication** — supports no auth, HTTP Basic auth, and Bearer auth
- **Comprehensive AKHQ API coverage** — topics, consumer groups, schema registry, nodes/brokers, Kafka Connect, ksqlDB, ACLs

## Installation

```bash
npm install
npm run build
```

Or run directly via `npx`:

```json
{
  "mcpServers": {
    "akhq": {
      "command": "npx",
      "args": ["akhq-mcp-server"]
    }
  }
}
```

## Configuration

### Option 1: Config file (recommended for multiple environments)

Set the `AKHQ_CONFIG_FILE` environment variable to point to a JSON config file:

```bash
AKHQ_CONFIG_FILE=/path/to/akhq-config.json npx akhq-mcp-server
```

**Example config file** (`akhq-config.json`):

```json
{
  "environments": [
    {
      "name": "local",
      "baseUrl": "http://localhost:8080",
      "auth": { "type": "none" }
    },
    {
      "name": "dev",
      "baseUrl": "https://akhq-dev.example.com",
      "auth": {
        "type": "basic",
        "username": "admin",
        "password": "secret"
      }
    },
    {
      "name": "prod",
      "baseUrl": "https://akhq-prod.example.com",
      "auth": {
        "type": "bearer",
        "token": "eyJhbGci..."
      }
    }
  ],
  "defaultEnvironment": "local"
}
```

Auth types:
- `"none"` — no authentication
- `"basic"` — HTTP Basic authentication (username + password)
- `"bearer"` — Bearer authentication

### Option 2: Environment variables (single environment)

| Variable | Description | Default |
|---|---|---|
| `AKHQ_BASE_URL` | Base URL of your AKHQ instance | `http://localhost:8080` |
| `AKHQ_ENV_NAME` | Name for this environment | `default` |
| `AKHQ_AUTH_TYPE` | Auth type: `none`, `basic`, or `bearer` | `none` |
| `AKHQ_AUTH_USERNAME` | Username (for `basic` auth) | |
| `AKHQ_AUTH_PASSWORD` | Password (for `basic` auth) | |
| `AKHQ_AUTH_TOKEN` | Bearer token (for `bearer` auth) | |

**Example with basic auth:**

```bash
AKHQ_BASE_URL=https://akhq.example.com \
AKHQ_AUTH_TYPE=basic \
AKHQ_AUTH_USERNAME=admin \
AKHQ_AUTH_PASSWORD=secret \
node dist/main.js
```

## MCP Client Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "akhq": {
      "command": "node",
      "args": ["/path/to/akhq-mcp-server/dist/main.js"],
      "env": {
        "AKHQ_CONFIG_FILE": "/path/to/akhq-config.json"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project or globally:

```json
{
  "mcpServers": {
    "akhq": {
      "command": "node",
      "args": ["/path/to/akhq-mcp-server/dist/main.js"],
      "env": {
        "AKHQ_BASE_URL": "http://localhost:8080"
      }
    }
  }
}
```

## Available Tools

### Environment Management

| Tool | Description |
|---|---|
| `list_environments` | List all configured AKHQ environments |
| `set_environment` | Switch the active AKHQ environment |
| `get_current_environment` | Get the currently active environment |

### General

| Tool | Description |
|---|---|
| `get_auths` | Get all auth details for current instance |
| `get_cluster` | Get all cluster info |
| `get_me` | Get current user info |
| `get_topic_defaults_configs` | Get default topic configuration |

### Topics

| Tool | Description |
|---|---|
| `get_topics` | List all topics |
| `post_topic` | Create a new topic |
| `get_topic` | Get topic details |
| `delete_topic` | Delete a topic |
| `get_topic_configs` | Get topic configuration |
| `post_topic_configs` | Update topic configuration |
| `get_topic_logs` | Get topic messages |
| `post_topic_produce` | Produce a message to a topic |
| `delete_topic_records` | Delete records from a topic |
| `get_topic_acls` | Get ACLs for a topic |

### Consumer Groups

| Tool | Description |
|---|---|
| `get_groups` | List all consumer groups |
| `get_group_by_name` | Get consumer group details |
| `delete_group` | Delete a consumer group |
| `get_group_offsets` | Get consumer group offsets |
| `post_group_offsets` | Update consumer group offsets |
| `get_group_acls` | Get ACLs for a consumer group |
| `get_group_members` | Get consumer group members |
| `get_group_topics` | Get topics for a consumer group |

### Schema Registry

| Tool | Description |
|---|---|
| `get_schemas` | List all schemas |
| `post_schema` | Create a new schema |
| `get_schema_by_subject` | Get schema by subject |
| `delete_schema` | Delete a schema |
| `get_schema_versions` | Get all versions of a schema |
| `get_schema_version` | Get a specific schema version |

### Nodes / Brokers

| Tool | Description |
|---|---|
| `get_nodes` | List all nodes |
| `get_node` | Get node details |
| `get_node_configs` | Get node configuration |
| `post_node_configs` | Update node configuration |
| `get_node_logs` | Get node log configuration |

### Kafka Connect

| Tool | Description |
|---|---|
| `get_connects` | List all connectors |
| `post_connect` | Create a connector |
| `get_connect_by_name` | Get connector details |
| `delete_connect` | Delete a connector |
| `get_connect_configs` | Get connector configuration |
| `post_connect_configs` | Update connector configuration |
| `get_connect_pause` | Pause a connector |
| `get_connect_resume` | Resume a connector |
| `get_connect_restart` | Restart a connector |
| `get_connect_tasks` | Get connector tasks |
| `get_connect_task_restart` | Restart a connector task |
| `get_connect_plugins` | List connect plugins |

### ksqlDB

| Tool | Description |
|---|---|
| `get_ksqldb_info` | Get ksqlDB server info |
| `get_ksqldb_queries` | List ksqlDB queries |
| `get_ksqldb_streams` | List ksqlDB streams |
| `get_ksqldb_tables` | List ksqlDB tables |
| `put_ksqldb_execute` | Execute a ksqlDB statement |
| `put_ksqldb_query` | Execute a ksqlDB pull query |

### ACLs

| Tool | Description |
|---|---|
| `get_acls` | List all ACLs for a cluster |
| `get_acls_by_principal` | Get ACLs for a specific principal |

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
```

## License

MIT
