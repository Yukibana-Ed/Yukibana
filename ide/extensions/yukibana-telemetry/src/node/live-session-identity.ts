/**
 * SPDX-License-Identifier: MIT
 */
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { inject, injectable } from '@theia/core/shared/inversify';

@injectable()
export class LiveSessionIdentity {
    @inject(ApplicationServer) protected readonly appServer!: ApplicationServer;

    protected _studentId?: string;
    protected _projectId?: string;
    protected _configHash?: string;

    get studentId(): string | undefined {
        return this._studentId;
    }
    get projectId(): string | undefined {
        return this._projectId;
    }
    get configHash(): string | undefined {
        return this._configHash;
    }
    get clientVersion(): Promise<string | undefined> {
        return this.appServer.getApplicationInfo().then(i => i?.version);
    }

    setStudentId(studentId: string): void {
        this._studentId = studentId;
    }
    setProjectId(projectId: string): void {
        this._projectId = projectId;
    }
    setConfigHash(configHash: string): void {
        this._configHash = configHash;
    }
}
