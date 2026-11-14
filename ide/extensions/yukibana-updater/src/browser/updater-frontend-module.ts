import { CommandContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { UPDATER_PATH, UpdaterServer } from '../common/updater-protocol';
import { UpdaterFrontendContribution, UpdaterStateHolder } from './updater-frontend-contribution';

/** The Electron frontend's updater: the connection to the main process's updater, its status bar item and commands. */
export default new ContainerModule(bind => {
    bind(UpdaterStateHolder).toSelf().inSingletonScope();
    bind(UpdaterServer)
        .toDynamicValue(ctx => ElectronIpcConnectionProvider.createProxy<UpdaterServer>(ctx.container, UPDATER_PATH, ctx.container.get(UpdaterStateHolder)))
        .inSingletonScope();
    bind(UpdaterFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(UpdaterFrontendContribution);
    bind(CommandContribution).toService(UpdaterFrontendContribution);
});
