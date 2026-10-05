import type { IConfiguration } from 'dependency-cruiser'

/** One or more top-level areas under `src/`, matched as whole directories. */
const areas = (...names: readonly string[]) => `^src/(${names.join('|')})(/|$)`
/** Everything the repository owns; anything else is a dependency. */
const owned = '^src/'
const testFile = '\\.test\\.ts$'
const entrypoints = areas('mcp-server', 'auth-server')

const config: IConfiguration = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle is two modules disagreeing about which of them is underneath.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-unresolvable',
      comment: 'Every rule matches resolved paths, so an unresolved import would cross any boundary unseen.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: 'config-is-the-floor',
      comment:
        'Configuration is a plain value every layer receives; it depends on no implementation that consumes it. Its only owned input is the dependency-free path primitives in utils/paths.ts that expand and parse configured roots.',
      severity: 'error',
      from: { path: areas('config') },
      to: { path: owned, pathNot: `${areas('config')}|^src/utils/paths\\.ts$` }
    },
    {
      name: 'shared-types-are-a-leaf',
      comment:
        'src/types.ts is the Graph response vocabulary every layer names; it imports nothing the repository owns.',
      severity: 'error',
      from: { path: '^src/types\\.ts$' },
      to: { path: owned }
    },
    {
      name: 'utils-stay-shared',
      comment:
        "Helpers shared verbatim with sibling MCPs take config primitives, never this server's implementations or tools.",
      severity: 'error',
      from: { path: areas('utils') },
      to: { path: areas('main', 'tools', 'mcp-server', 'auth-server', 'generated') }
    },
    {
      name: 'main-stays-transport-free',
      comment:
        'Implementations in main/ are usable from a script: they never reach the tool layer, the entrypoints, the generated MCP client or the MCP SDK. Tests beside them may drive the registered tool end to end; they never ship.',
      severity: 'error',
      from: { path: areas('main'), pathNot: testFile },
      to: {
        path: `${areas('tools', 'mcp-server', 'auth-server', 'generated')}|(^|/)node_modules/@modelcontextprotocol/`
      }
    },
    {
      name: 'tools-stay-thin',
      comment:
        'A tool module declares schema and annotations and hands its arguments to a main/ entrypoint; logic reached past that surface escapes the tested implementation. Shared Zod schemas are the exception: the Graph id schema in utils/odata-helpers.ts and the draft recipient schema main/email/draft-actions.ts validates with.',
      severity: 'error',
      from: { path: areas('tools'), pathNot: testFile },
      to: {
        path: owned,
        pathNot: `^src/(tools|main/[^/]+/index\\.ts$|main/email/draft-actions\\.ts$|config/index\\.ts$|utils/(annotations|odata-helpers)\\.ts$)`
      }
    },
    {
      name: 'entrypoints-are-not-imported',
      comment: 'The MCP and OAuth servers load configuration and start processes; nothing else may import them.',
      severity: 'error',
      from: { path: owned, pathNot: entrypoints },
      to: { path: entrypoints }
    },
    {
      name: 'registration-tests-keep-the-tool-seam',
      comment:
        'Registration tests assert schemas, annotations and access gating through the tool modules, with main/ mocked rather than imported; naming a main/ type is erased and imports nothing.',
      severity: 'error',
      from: { path: `^src/tools/.+${testFile}` },
      to: { path: areas('main', 'mcp-server', 'auth-server'), dependencyTypesNot: ['type-only'] }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // A type-only import crosses a boundary exactly as a value import does,
    // except where a rule above states otherwise.
    tsPreCompilationDeps: true,
    // The MCP SDK and Zod resolve only through subpath exports.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.d.ts', '.json']
    }
  }
}

export default config
