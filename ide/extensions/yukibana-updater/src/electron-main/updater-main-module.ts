import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { ContainerModule } from '@theia/core/shared/inversify';
import { UPDATER_PATH, UpdaterClient } from '../common/updater-protocol';
import { UpdaterMainService } from './updater-main-service';

/** The updater in the Electron main process, and its service for the frontends at {@link UPDATER_PATH}. */
export default new ContainerModule(bind => {
    bind(UpdaterMainService).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(UpdaterMainService);
    bind(ElectronConnectionHandler)
        .toDynamicValue(context => new RpcConnectionHandler<UpdaterClient>(UPDATER_PATH, client => context.container.get(UpdaterMainService).connect(client)))
        .inSingletonScope();
});
