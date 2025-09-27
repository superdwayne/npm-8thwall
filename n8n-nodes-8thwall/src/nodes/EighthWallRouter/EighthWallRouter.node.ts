import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

type AnyObj = Record<string, any>;

function slugify(filename: string): string {
  const base = filename.split(/[?#]/)[0];
  return base.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function pickColorFromText(t: string): string | undefined {
  const mHex = t.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (mHex) return `#${mHex[1]}`;
  const names = ['red','green','blue','white','black','gray','grey','yellow','orange','purple','pink','cyan','magenta'];
  const f = names.find((n) => t.includes(n));
  return f;
}

function findNumber(t: string, def: number): number {
  const m = t.match(/\b(\d{2,5})\b/);
  return m ? Number(m[1]) : def;
}

export class EighthWallRouter implements INodeType {
  description: INodeTypeDescription = {
    displayName: '8th Wall MCP Router',
    name: 'eighthWallMcpRouter',
    icon: 'file:wall.svg',
    group: ['transform'],
    version: 1,
    description: 'Map a natural-language request to MCP tool calls',
    defaults: { name: '8th Wall MCP Router' },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Request',
        name: 'request',
        type: 'string',
        default: '',
        description: 'What you want to do (free text). You can also pass JSON fields like url, color, type, position, etc. in the incoming item.'
      },
      {
        displayName: 'Default Template',
        name: 'defaultTemplate',
        type: 'options',
        options: [
          { name: 'A-Frame', value: 'aframe' },
          { name: 'Three.js', value: 'three' },
        ],
        default: 'aframe',
      },
      {
        displayName: 'Default Port',
        name: 'defaultPort',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 65535 },
        default: 5173,
      },
      {
        displayName: 'Default Model Folder',
        name: 'defaultModelFolder',
        type: 'string',
        default: 'models',
        description: 'Relative to project/assets/. Used when deriving filenames for downloads.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    const defaultTemplate = this.getNodeParameter('defaultTemplate', 0) as 'aframe' | 'three';
    const defaultPort = this.getNodeParameter('defaultPort', 0) as number;
    const defaultModelFolder = this.getNodeParameter('defaultModelFolder', 0) as string;

    for (let i = 0; i < items.length; i++) {
      const request = String(this.getNodeParameter('request', i) || items[i].json.request || '');
      const lower = request.toLowerCase();
      const input: AnyObj = items[i].json || {};
      const seq: Array<{ tool: string; args: AnyObj; explanation?: string }> = [];

      // Scaffold project
      if (/\b(scaffold|create|init|bootstrap)\b/.test(lower)) {
        let template: 'aframe' | 'three' = defaultTemplate;
        if (/\bthree\b/.test(lower)) template = 'three';
        if (/\baframe\b/.test(lower)) template = 'aframe';
        seq.push({ tool: 'project_scaffold', args: { template, overwrite: true }, explanation: 'Scaffold project' });
      }

      // Start dev server
      if (/\b(start|run|serve|preview)\b/.test(lower) && /(dev|server|preview)/.test(lower)) {
        const port = input.port ? Number(input.port) : findNumber(lower, defaultPort);
        seq.push({ tool: 'devserver_start', args: { port }, explanation: `Start dev server on ${port}` });
      }

      // Background color
      if (/background/.test(lower) && /color/.test(lower)) {
        const color = input.color || pickColorFromText(lower) || '#333333';
        seq.push({ tool: 'scene_set_background_color', args: { color }, explanation: `Set background ${color}` });
      }

      // Add primitive
      if (/\b(add|insert|spawn)\b/.test(lower) && /(box|sphere|cylinder|plane)\b/.test(lower)) {
        const type = (lower.match(/(box|sphere|cylinder|plane)\b/)?.[1] || input.type || 'box') as 'box'|'sphere'|'cylinder'|'plane';
        const color = input.color || pickColorFromText(lower) || '#FFD166';
        const args: AnyObj = { type, color };
        if (input.size) args.size = input.size;
        if (input.position) args.position = input.position;
        if (input.rotation) args.rotation = input.rotation;
        if (input.scale) args.scale = input.scale;
        seq.push({ tool: 'scene_add_primitive', args, explanation: `Add ${type}` });
      }

      // Add light
      if (/\b(light|lighting)\b/.test(lower)) {
        const kind = (lower.match(/(ambient|hemisphere|directional|point)/)?.[1] || input.kind || 'hemisphere') as 'ambient'|'hemisphere'|'directional'|'point';
        const intensity = input.intensity ? Number(input.intensity) : undefined;
        const args: AnyObj = { kind };
        if (input.color) args.color = input.color;
        if (intensity !== undefined) args.intensity = intensity;
        if (input.position) args.position = input.position;
        seq.push({ tool: 'scene_add_light', args, explanation: `Add ${kind} light` });
      }

      // Add OrbitControls / Grid / Floor
      if (/\borbit\b/.test(lower)) seq.push({ tool: 'scene_add_orbit_controls', args: {}, explanation: 'Add OrbitControls' });
      if (/\bgrid\b/.test(lower)) seq.push({ tool: 'scene_add_grid_helper', args: {}, explanation: 'Add GridHelper' });
      if (/\bfloor\b/.test(lower)) seq.push({ tool: 'scene_add_floor', args: {}, explanation: 'Add floor plane' });

      // Environment HDR
      if (/\b(hdr|environment)\b/.test(lower) && (input.url || /(https?:\/\/\S+)/.test(request))) {
        const url = String(input.url || request.match(/(https?:\/\/\S+)/)?.[1]);
        seq.push({ tool: 'scene_set_environment_hdr', args: { url }, explanation: 'Set environment HDR' });
      }

      // Model: if given a URL, produce two steps (download + add). Else, if src, add directly.
      const modelIntent = /\b(model|gltf|glb)\b/.test(lower) || input.src || input.url;
      if (modelIntent) {
        if (input.url || /(https?:\/\/\S+\.(?:gltf|glb))(?!\S)/i.test(request)) {
          const url = String(input.url || request.match(/(https?:\/\/\S+\.(?:gltf|glb))(?!\S)/i)?.[1]);
          const base = slugify(url.split('/').pop() || 'Model.glb');
          const rel = `${defaultModelFolder}/${base}`;
          seq.push({ tool: 'assets_download_url', args: { url, filename: rel }, explanation: 'Download model' });
          seq.push({ tool: 'scene_add_gltf_model', args: { src: `assets/${rel}` }, explanation: 'Add model to scene' });
        } else if (input.src) {
          seq.push({ tool: 'scene_add_gltf_model', args: { src: input.src, position: input.position, scale: input.scale }, explanation: 'Add model to scene' });
        }
      }

      // If nothing matched, default to health_ping
      if (seq.length === 0) {
        seq.push({ tool: 'health_ping', args: { message: request || 'ping' }, explanation: 'Fallback health' });
      }

      // Emit items: one output item per tool call
      for (const step of seq) {
        out.push({ json: { request, tool: step.tool, args: step.args, explanation: step.explanation } });
      }
    }

    return [out];
  }
}

