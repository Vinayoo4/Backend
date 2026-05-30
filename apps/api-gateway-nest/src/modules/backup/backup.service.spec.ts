import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from './backup.service';
import * as child_process from 'child_process';

jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, callback) => {
    if (callback) callback(null, { stdout: '', stderr: '' });
  }),
}));

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BackupService],
    }).compile();

    service = module.get<BackupService>(BackupService);

    // Clear mock calls before each test
    (child_process.execFile as unknown as jest.Mock).mockClear();

    // Set up env variables
    process.env.DB_USER = 'test_user';
    process.env.DB_HOST = 'test_host';
    process.env.DB_NAME = 'test_db';
    process.env.MONGO_URI = 'mongodb://test';
  });

  afterEach(() => {
    delete process.env.DB_USER;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.MONGO_URI;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('backupPostgres', () => {
    it('should call execFile with pg_dump and proper array arguments to prevent command injection', async () => {
      const filePath = await service.backupPostgres();

      expect(child_process.execFile).toHaveBeenCalledTimes(1);

      const [cmd, args] = (child_process.execFile as unknown as jest.Mock).mock.calls[0];

      expect(cmd).toBe('pg_dump');
      expect(args).toEqual([
        '-U',
        'test_user',
        '-h',
        'test_host',
        '-f',
        filePath,
        'test_db'
      ]);
      expect(filePath).toMatch(/^\/tmp\/pg-backup-\d+\.sql$/);
    });
  });

  describe('backupMongo', () => {
    it('should call execFile with mongodump and proper array arguments to prevent command injection', async () => {
      const filePath = await service.backupMongo();

      expect(child_process.execFile).toHaveBeenCalledTimes(1);

      const [cmd, args] = (child_process.execFile as unknown as jest.Mock).mock.calls[0];

      expect(cmd).toBe('mongodump');
      expect(args).toEqual([
        '--uri=mongodb://test',
        `--archive=${filePath}`,
        '--gzip'
      ]);
      expect(filePath).toMatch(/^\/tmp\/mongo-backup-\d+\.gz$/);
    });
  });
});
