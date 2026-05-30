import { Test, TestingModule } from '@nestjs/testing';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';
import { ReasonDto } from './dto/reason.dto';

describe('BrainController', () => {
  let controller: BrainController;
  let service: BrainService;

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
    service = module.get<BrainService>(BrainService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('reason', () => {
    it('should call BrainService.reason with correct arguments and return its result', async () => {
      // Arrange
      const mockDto: ReasonDto = {
        prompt: 'Analyze this financial data.',
        metadata: { source: 'api-gateway' },
      };
      const mockReq = { tenantId: 'tenant-123' };
      const expectedResponse = {
        decision: 'Everything looks good.',
        confidence_score: 0.95,
      };

      mockBrainService.reason.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.reason(mockDto, mockReq);

      // Assert
      expect(service.reason).toHaveBeenCalledWith(
        mockDto.prompt,
        mockReq.tenantId,
        mockDto.metadata,
      );
      expect(service.reason).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });

    it('should handle request without metadata', async () => {
      // Arrange
      const mockDto: ReasonDto = {
        prompt: 'What is the answer to life?',
      };
      const mockReq = { tenantId: 'tenant-456' };
      const expectedResponse = {
        decision: '42',
        confidence_score: 1.0,
      };

      mockBrainService.reason.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.reason(mockDto, mockReq);

      // Assert
      expect(service.reason).toHaveBeenCalledWith(
        mockDto.prompt,
        mockReq.tenantId,
        undefined,
      );
      expect(service.reason).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });
  });
});
