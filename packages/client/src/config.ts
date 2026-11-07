/** `@yukibana/client/config`: what a `yukibana.json` says, and nothing else.
 *
 *  Pure and browser-safe: it imports zod and no Node module, so an IDE
 *  extension's browser code and the registry's Worker may import it at
 *  runtime. The root entry (`@yukibana/client`) reads disks and opens
 *  sockets; browser code imports only types from it (`import type`, which
 *  the IDE's lint enforces). Each name here is exported from this entry
 *  only, not from the root.
 */

export {
    buildOutput,
    CONFIG_FILE,
    DEFAULT_SETTINGS,
    excludes,
    IDE_STATE,
    isProjectId,
    isUuid,
    KINDS,
    NEVER_SUBMITTED,
    parseConfig,
    parseSettings,
    starterConfig,
    type Config,
    type Kind,
    type Settings,
} from './lib/yukibana.js';
