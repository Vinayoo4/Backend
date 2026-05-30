// apps/api-gateway-nest/src/modules/backup/backup.service.ts
import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class BackupService {
  /** Trigger a Postgres pg_dump to /tmp and return the file path */
  async backupPostgres(): Promise<string> {
    const filePath = `/tmp/pg-backup-${Date.now()}.sql`;
    await execFileAsync('pg_dump', [
      '-U',
      process.env.DB_USER || '',
      '-h',
      process.env.DB_HOST || '',
      '-f',
      filePath,
      process.env.DB_NAME || '',
    ]);
    return filePath;
  }

  /** Trigger a mongodump archive to /tmp and return the file path */
  async backupMongo(): Promise<string> {
    const filePath = `/tmp/mongo-backup-${Date.now()}.gz`;
    await execFileAsync('mongodump', [
      `--uri=${process.env.MONGO_URI || ''}`,
      `--archive=${filePath}`,
      '--gzip',
    ]);
    return filePath;
  }
}
