#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { callApi, parameterizeEndpoint, type TokenStore } from './api.js';
import type { Environment } from './config.js';

const config = loadConfig();

// ─── Token store: env name → active bearer token (in-memory only) ─────────────
const tokenStore: TokenStore = new Map<string, string>();

// Seed the token store from config for any environments that already have a token
for (const env of config.environments) {
  if (env.auth.type === 'bearer' && env.auth.token) {
    tokenStore.set(env.name, env.auth.token);
  }
}

let currentEnvironmentName: string =
  config.defaultEnvironment ?? config.environments[0].name;

function getEnvironment(): Environment {
  const env = config.environments.find((e) => e.name === currentEnvironmentName);
  if (!env) {
    throw new Error('No environment configured: ' + currentEnvironmentName);
  }
  return env;
}

const server = new McpServer({
  name: 'akhq-mcp-server',
  version: '1.0.0',
});

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
type Handler<T extends Record<string, unknown>> = (params: T) => Promise<ToolResult>;

function registerTool<T extends Record<string, unknown>>(
  name: string,
  description: string,
  parameters: Record<string, z.ZodTypeAny>,
  handler: Handler<T>,
): void {
  server.tool(name, description, parameters, async (params) => {
    try {
      return await handler(params as T);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Validation error', details: error.issues }) }],
        };
      }
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
    }
  });
}

// ─── Environment Management ───────────────────────────────────────────────────

registerTool(
  'list_environments',
  'List all configured AKHQ environments',
  {},
  async () => ({
    content: [{
      type: 'text' as const,
      text: JSON.stringify(config.environments.map((e) => ({
        name: e.name,
        baseUrl: e.baseUrl,
        authType: e.auth.type,
        hasToken: e.auth.type === 'bearer' ? tokenStore.has(e.name) : undefined,
      }))),
    }],
  }),
);

registerTool(
  'set_environment',
  'Switch the active AKHQ environment',
  { name: z.string().describe('The environment name to switch to') },
  async ({ name }: { name: string }) => {
    const found = config.environments.find((e) => e.name === name);
    if (!found) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Environment not found: ' + name }) }] };
    }
    currentEnvironmentName = name;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, activeEnvironment: currentEnvironmentName }) }] };
  },
);

registerTool(
  'get_current_environment',
  'Get the currently active AKHQ environment',
  {},
  async () => {
    const env = getEnvironment();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          name: env.name,
          baseUrl: env.baseUrl,
          authType: env.auth.type,
          hasToken: env.auth.type === 'bearer' ? tokenStore.has(env.name) : undefined,
        }),
      }],
    };
  },
);

// ─── General ─────────────────────────────────────────────────────────────────

registerTool(
  'set_bearer_token',
  'Set or refresh the bearer token for an AKHQ environment. Use this when a request fails with an expired/unauthorized token error.',
  {
    environment: z.string().describe('The environment name to set the token for'),
    token: z.string().describe('The new bearer token'),
  },
  async ({ environment, token }: { environment: string; token: string }) => {
    const found = config.environments.find((e) => e.name === environment);
    if (!found) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Environment not found: ' + environment }) }] };
    }
    if (found.auth.type !== 'bearer') {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Environment "' + environment + '" does not use bearer authentication.' }) }] };
    }
    tokenStore.set(environment, token);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, environment }) }] };
  },
);

registerTool(
  'clear_bearer_token',
  'Clear the stored bearer token for an AKHQ environment. The next API call will fail with an auth error prompting for a new token.',
  {
    environment: z.string().describe('The environment name whose token should be cleared'),
  },
  async ({ environment }: { environment: string }) => {
    tokenStore.delete(environment);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, environment, message: 'Token cleared. Call set_bearer_token to provide a new one.' }) }] };
  },
);

registerTool('get_auths', 'Get all auth details for current instance', {}, async () => {
  const endpoint = parameterizeEndpoint('/api/auths', {});
  return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
});

registerTool('get_cluster', 'Get all cluster info for current instance', {}, async () => {
  const endpoint = parameterizeEndpoint('/api/cluster', {});
  return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
});

registerTool('get_me', 'Get current user info', {}, async () => {
  const endpoint = parameterizeEndpoint('/api/me', {});
  return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
});

registerTool('get_topic_defaults_configs', 'Get default topic configuration', {}, async () => {
  const endpoint = parameterizeEndpoint('/api/topic/defaults-configs', {});
  return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
});

// ─── ACLs ─────────────────────────────────────────────────────────────────────

registerTool(
  'get_acls',
  'List all ACLs for a cluster',
  {
    cluster: z.string().describe('Cluster name'),
    search: z.string().optional().nullable().describe('Optional search term'),
  },
  async (params: { cluster: string; search?: string | null }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/acls', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_acls_by_principal',
  'Get ACLs for a specific principal',
  {
    cluster: z.string().describe('Cluster name'),
    principal: z.string().describe('Principal name'),
    resourceType: z.string().optional().nullable().describe('Resource type filter'),
  },
  async (params: { cluster: string; principal: string; resourceType?: string | null }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/acls/{principal}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── Topics ───────────────────────────────────────────────────────────────────

registerTool(
  'get_topics',
  'List all topics for a cluster',
  {
    cluster: z.string().describe('Cluster name'),
    search: z.string().optional().nullable().describe('Search term'),
    show: z.string().optional().nullable().describe('Filter: ALL, HIDE_INTERNAL, HIDE_INTERNAL_STREAM'),
    page: z.number().optional().nullable().describe('Page number'),
    perPage: z.number().optional().nullable().describe('Items per page'),
    sortField: z.string().optional().nullable(),
    sortOrder: z.string().optional().nullable(),
  },
  async (params: Record<string, unknown>) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_topic',
  'Create a new topic',
  {
    cluster: z.string().describe('Cluster name'),
    name: z.string().describe('Topic name'),
    partition: z.number().optional().describe('Number of partitions'),
    replication: z.number().optional().describe('Replication factor'),
    configs: z.record(z.string(), z.string()).optional().describe('Topic configurations'),
  },
  async (params: { cluster: string; name: string; partition?: number; replication?: number; configs?: Record<string, string> }) => {
    const { cluster, ...body } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic', { cluster });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', body);
  },
);

registerTool(
  'get_topic',
  'Get details for a specific topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
  },
  async (params: { cluster: string; topicName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'delete_topic',
  'Delete a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
  },
  async (params: { cluster: string; topicName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'DELETE');
  },
);

registerTool(
  'get_topic_configs',
  'Get configuration for a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
  },
  async (params: { cluster: string; topicName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/configs', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_topic_configs',
  'Update configuration for a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
    configs: z.array(z.object({ name: z.string(), value: z.string() })).describe('Configuration entries'),
  },
  async (params: { cluster: string; topicName: string; configs: Array<{ name: string; value: string }> }) => {
    const { cluster, topicName, configs } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/configs', { cluster, topicName });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', configs);
  },
);

registerTool(
  'get_topic_logs',
  'Get logs (messages) for a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
    partition: z.number().optional().nullable(),
    sort: z.string().optional().nullable().describe('oldest or newest'),
    timestamp: z.string().optional().nullable().describe('ISO 8601 timestamp'),
    search: z.string().optional().nullable(),
    after: z.string().optional().nullable().describe('Pagination cursor'),
    page: z.number().optional().nullable(),
    perPage: z.number().optional().nullable(),
  },
  async (params: Record<string, unknown>) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/logs', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_topic_produce',
  'Produce a message to a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
    value: z.string().describe('Message value'),
    key: z.string().optional().nullable().describe('Message key'),
    partition: z.number().optional().nullable().describe('Target partition'),
    headers: z.record(z.string(), z.string()).optional().nullable().describe('Message headers'),
  },
  async (params: { cluster: string; topicName: string; value: string; key?: string | null; partition?: number | null; headers?: Record<string, string> | null }) => {
    const { cluster, topicName, ...body } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/produce', { cluster, topicName });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', body);
  },
);

registerTool(
  'delete_topic_records',
  'Delete records from a topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
    offset: z.number().describe('Delete records up to this offset'),
    partition: z.number().describe('Partition number'),
  },
  async (params: { cluster: string; topicName: string; offset: number; partition: number }) => {
    const { cluster, topicName, offset, partition } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/deleteRecords', { cluster, topicName });
    return callApi(getEnvironment(), tokenStore, endpoint, 'DELETE', { offset, partition });
  },
);

registerTool(
  'get_topic_acls',
  'Get ACLs for a specific topic',
  {
    cluster: z.string().describe('Cluster name'),
    topicName: z.string().describe('Topic name'),
  },
  async (params: { cluster: string; topicName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/topic/{topicName}/acls', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── Consumer Groups ───────────────────────────────────────────────────────────

registerTool(
  'get_groups',
  'List all consumer groups',
  {
    cluster: z.string().describe('Cluster name'),
    search: z.string().optional().nullable(),
    page: z.number().optional().nullable(),
    perPage: z.number().optional().nullable(),
  },
  async (params: Record<string, unknown>) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_group_by_name',
  'Get details for a specific consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'delete_group',
  'Delete a consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'DELETE');
  },
);

registerTool(
  'get_group_offsets',
  'Get offsets for a consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}/offsets', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_group_offsets',
  'Update consumer group offsets',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
    offsets: z.array(z.object({
      topic: z.string(),
      partition: z.number(),
      offset: z.number(),
    })).describe('Offsets to set'),
  },
  async (params: { cluster: string; groupName: string; offsets: Array<{ topic: string; partition: number; offset: number }> }) => {
    const { cluster, groupName, offsets } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}/offsets', { cluster, groupName });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', offsets);
  },
);

registerTool(
  'get_group_acls',
  'Get ACLs for a consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}/acls', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_group_members',
  'Get members of a consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}/members', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_group_topics',
  'Get topics for a consumer group',
  {
    cluster: z.string().describe('Cluster name'),
    groupName: z.string().describe('Consumer group name'),
  },
  async (params: { cluster: string; groupName: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/group/{groupName}/topics', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── Schema Registry ──────────────────────────────────────────────────────────

registerTool(
  'get_schemas',
  'List all schemas in the schema registry',
  {
    cluster: z.string().describe('Cluster name'),
    search: z.string().optional().nullable(),
    page: z.number().optional().nullable(),
    perPage: z.number().optional().nullable(),
  },
  async (params: Record<string, unknown>) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_schema',
  'Create a new schema',
  {
    cluster: z.string().describe('Cluster name'),
    subject: z.string().describe('Schema subject'),
    schema: z.string().describe('Schema definition (JSON string)'),
    schemaType: z.string().optional().describe('AVRO, JSON, PROTOBUF'),
  },
  async (params: { cluster: string; subject: string; schema: string; schemaType?: string }) => {
    const { cluster, ...body } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema', { cluster });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', body);
  },
);

registerTool(
  'get_schema_by_subject',
  'Get a schema by subject',
  {
    cluster: z.string().describe('Cluster name'),
    subject: z.string().describe('Schema subject'),
  },
  async (params: { cluster: string; subject: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema/{subject}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'delete_schema',
  'Delete a schema subject',
  {
    cluster: z.string().describe('Cluster name'),
    subject: z.string().describe('Schema subject'),
  },
  async (params: { cluster: string; subject: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema/{subject}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'DELETE');
  },
);

registerTool(
  'get_schema_versions',
  'Get all versions of a schema',
  {
    cluster: z.string().describe('Cluster name'),
    subject: z.string().describe('Schema subject'),
  },
  async (params: { cluster: string; subject: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema/{subject}/version', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_schema_version',
  'Get a specific version of a schema',
  {
    cluster: z.string().describe('Cluster name'),
    subject: z.string().describe('Schema subject'),
    version: z.number().describe('Schema version'),
  },
  async (params: { cluster: string; subject: string; version: number }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/schema/{subject}/version/{version}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── Nodes / Brokers ──────────────────────────────────────────────────────────

registerTool(
  'get_nodes',
  'List all nodes (brokers) in a cluster',
  {
    cluster: z.string().describe('Cluster name'),
  },
  async (params: { cluster: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/node', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_node',
  'Get details for a specific node',
  {
    cluster: z.string().describe('Cluster name'),
    nodeId: z.number().describe('Node ID'),
  },
  async (params: { cluster: string; nodeId: number }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/node/{nodeId}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_node_configs',
  'Get configuration for a node',
  {
    cluster: z.string().describe('Cluster name'),
    nodeId: z.number().describe('Node ID'),
  },
  async (params: { cluster: string; nodeId: number }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/node/{nodeId}/configs', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_node_configs',
  'Update configuration for a node',
  {
    cluster: z.string().describe('Cluster name'),
    nodeId: z.number().describe('Node ID'),
    configs: z.array(z.object({ name: z.string(), value: z.string() })).describe('Configuration entries'),
  },
  async (params: { cluster: string; nodeId: number; configs: Array<{ name: string; value: string }> }) => {
    const { cluster, nodeId, configs } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/node/{nodeId}/configs', { cluster, nodeId });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', configs);
  },
);

registerTool(
  'get_node_logs',
  'Get log configuration for a node',
  {
    cluster: z.string().describe('Cluster name'),
    nodeId: z.number().describe('Node ID'),
  },
  async (params: { cluster: string; nodeId: number }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/node/{nodeId}/logs', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── Kafka Connect ────────────────────────────────────────────────────────────

registerTool(
  'get_connects',
  'List all connect definitions for a cluster',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    search: z.string().optional().nullable(),
    page: z.number().optional().nullable(),
    perPage: z.number().optional().nullable(),
  },
  async (params: Record<string, unknown>) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_connect',
  'Create a new connect definition',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
    configs: z.record(z.string(), z.string()).describe('Connector configuration'),
  },
  async (params: { cluster: string; connectId: string; name: string; configs: Record<string, string> }) => {
    const { cluster, connectId, ...body } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}', { cluster, connectId });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', body);
  },
);

registerTool(
  'get_connect_by_name',
  'Get a specific connect definition',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'delete_connect',
  'Delete a connect definition',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'DELETE');
  },
);

registerTool(
  'get_connect_configs',
  'Get configuration of a connector',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/configs', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'post_connect_configs',
  'Update a connector configuration',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
    configs: z.record(z.string(), z.string()).describe('Connector configuration'),
  },
  async (params: { cluster: string; connectId: string; name: string; configs: Record<string, string> }) => {
    const { cluster, connectId, name, configs } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/configs', { cluster, connectId, name });
    return callApi(getEnvironment(), tokenStore, endpoint, 'POST', configs);
  },
);

registerTool(
  'get_connect_pause',
  'Pause a connector',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/pause', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_connect_resume',
  'Resume a connector',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/resume', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_connect_restart',
  'Restart a connector',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/restart', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_connect_tasks',
  'Get tasks for a connector',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
  },
  async (params: { cluster: string; connectId: string; name: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/tasks', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_connect_task_restart',
  'Restart a specific connector task',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
    name: z.string().describe('Connector name'),
    taskId: z.number().describe('Task ID'),
  },
  async (params: { cluster: string; connectId: string; name: string; taskId: number }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/{name}/tasks/{taskId}/restart', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_connect_plugins',
  'List all connect plugins',
  {
    cluster: z.string().describe('Cluster name'),
    connectId: z.string().describe('Connect cluster ID'),
  },
  async (params: { cluster: string; connectId: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/connect/{connectId}/plugins', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

// ─── ksqlDB ───────────────────────────────────────────────────────────────────

registerTool(
  'get_ksqldb_info',
  'Get ksqlDB server info',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
  },
  async (params: { cluster: string; ksqldb: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/info', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_ksqldb_queries',
  'List all ksqlDB queries',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
  },
  async (params: { cluster: string; ksqldb: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/queries', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_ksqldb_streams',
  'List all ksqlDB streams',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
  },
  async (params: { cluster: string; ksqldb: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/streams', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'get_ksqldb_tables',
  'List all ksqlDB tables',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
  },
  async (params: { cluster: string; ksqldb: string }) => {
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/tables', params);
    return callApi(getEnvironment(), tokenStore, endpoint, 'GET');
  },
);

registerTool(
  'put_ksqldb_execute',
  'Execute a ksqlDB statement',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
    ksql: z.string().describe('The ksql statement to execute'),
    streamsProperties: z.record(z.string(), z.string()).optional().describe('Properties for the streams application'),
  },
  async (params: { cluster: string; ksqldb: string; ksql: string; streamsProperties?: Record<string, string> }) => {
    const { cluster, ksqldb, ...body } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/execute', { cluster, ksqldb });
    return callApi(getEnvironment(), tokenStore, endpoint, 'PUT', body);
  },
);

registerTool(
  'put_ksqldb_query',
  'Execute a ksqlDB pull query',
  {
    cluster: z.string().describe('Cluster name'),
    ksqldb: z.string().describe('ksqlDB cluster name'),
    sql: z.string().describe('The SQL query to execute'),
  },
  async (params: { cluster: string; ksqldb: string; sql: string }) => {
    const { cluster, ksqldb, sql } = params;
    const endpoint = parameterizeEndpoint('/api/{cluster}/ksqldb/{ksqldb}/query', { cluster, ksqldb });
    return callApi(getEnvironment(), tokenStore, endpoint, 'PUT', { sql });
  },
);

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
