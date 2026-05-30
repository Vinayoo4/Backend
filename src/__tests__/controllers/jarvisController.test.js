const { forecast } = require('../../controllers/jarvisController');
const aiService = require('../../services/aiService');
const logger = require('../../config/logger');

// Mock dependencies
jest.mock('../../services/aiService');
jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('jarvisController - forecast', () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should return 400 if data is not an array', async () => {
    req.body.data = 'not-an-array';

    await forecast(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Provide at least 2 historical data points ({ date, revenue }).',
    });
  });

  it('should return 400 if data has less than 2 elements', async () => {
    req.body.data = [{ date: '2023-01-01', revenue: 100 }];

    await forecast(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Provide at least 2 historical data points ({ date, revenue }).',
    });
  });

  it('should forecast revenue with default horizon if not provided', async () => {
    const data = [
      { date: '2023-01-01', revenue: 100 },
      { date: '2023-01-02', revenue: 120 },
    ];
    req.body.data = data;
    const mockPredictions = [
      { date: '2023-01-03', revenue: 130 },
    ];
    aiService.predictRevenue.mockReturnValue(mockPredictions);

    await forecast(req, res);

    expect(aiService.predictRevenue).toHaveBeenCalledWith(data, 30);
    expect(logger.info).toHaveBeenCalledWith(
      `JARVIS forecast: ${data.length} points → ${mockPredictions.length} predictions`
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: mockPredictions });
  });

  it('should forecast revenue with provided horizon', async () => {
    const data = [
      { date: '2023-01-01', revenue: 100 },
      { date: '2023-01-02', revenue: 120 },
    ];
    req.body = { data, horizon: 10 };
    const mockPredictions = [
      { date: '2023-01-03', revenue: 130 },
    ];
    aiService.predictRevenue.mockReturnValue(mockPredictions);

    await forecast(req, res);

    expect(aiService.predictRevenue).toHaveBeenCalledWith(data, 10);
    expect(logger.info).toHaveBeenCalledWith(
      `JARVIS forecast: ${data.length} points → ${mockPredictions.length} predictions`
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: mockPredictions });
  });

  it('should fallback to 30 horizon if invalid horizon is provided', async () => {
    const data = [
      { date: '2023-01-01', revenue: 100 },
      { date: '2023-01-02', revenue: 120 },
    ];
    req.body = { data, horizon: 'invalid' };
    const mockPredictions = [
      { date: '2023-01-03', revenue: 130 },
    ];
    aiService.predictRevenue.mockReturnValue(mockPredictions);

    await forecast(req, res);

    expect(aiService.predictRevenue).toHaveBeenCalledWith(data, 30);
    expect(logger.info).toHaveBeenCalledWith(
      `JARVIS forecast: ${data.length} points → ${mockPredictions.length} predictions`
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: mockPredictions });
  });

  it('should handle errors and return 500 status', async () => {
    const data = [
      { date: '2023-01-01', revenue: 100 },
      { date: '2023-01-02', revenue: 120 },
    ];
    req.body.data = data;
    const error = new Error('AI Service error');
    aiService.predictRevenue.mockImplementation(() => {
      throw error;
    });

    await forecast(req, res);

    expect(logger.error).toHaveBeenCalledWith('JARVIS forecast error:', error.message);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: error.message });
  });
});
