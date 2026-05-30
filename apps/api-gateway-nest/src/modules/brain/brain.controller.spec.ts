import { Test, TestingModule } from '@nestjs/testing';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';
import { ReasonDto } from './dto/reason.dto';

describe('BrainController', () => {
  let controller: BrainController;
  let brainService: BrainService;

  const mockBrainService = {
    reason: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrainController],
      providers: [
        {
          provide: BrainService,
          useValue: mockBrainService,
        },
      ],
    }).compile();

    controller = module.get<BrainController>(BrainController);
    brainService = module.get<BrainService>(BrainService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reason', () => {
    it('should call brainService.reason with correct arguments', async () => {
      const dto: ReasonDto = {
        prompt: 'test prompt',
        metadata: { key: 'value' },
      };
      const req = { tenantId: 'test-tenant' };
      const expectedResult = { result: 'test result' };

      mockBrainService.reason.mockResolvedValue(expectedResult);

      const result = await controller.reason(dto, req);

      expect(brainService.reason).toHaveBeenCalledWith(
        dto.prompt,
        req.tenantId,
        dto.metadata,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle optional metadata correctly', async () => {
      const dto: ReasonDto = {
        prompt: 'test prompt',
      };
      const req = { tenantId: 'test-tenant' };
      const expectedResult = { result: 'test result' };

      mockBrainService.reason.mockResolvedValue(expectedResult);

      const result = await controller.reason(dto, req);

      expect(brainService.reason).toHaveBeenCalledWith(
        dto.prompt,
        req.tenantId,
        undefined, // since metadata is omitted
      );
      expect(result).toEqual(expectedResult);
    });
  });
});
