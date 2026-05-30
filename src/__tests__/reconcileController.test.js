const { initiateWorkflow } = require('../controllers/reconcileController');
const reconcileService = require('../services/reconcileService');
const logger = require('../config/logger');

// Mock dependencies
jest.mock('../services/reconcileService');
jest.mock('../config/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('reconcileController - initiateWorkflow', () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      body: {},
      tenantId: 'tenant-123',
      user: { id: 'user-456' },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should successfully initiate a workflow and return 201', async () => {
    const transactions = [{ id: 'tx-1' }, { id: 'tx-2' }];
    req.body = { transactions };

    const mockWorkflow = { id: 'workflow-789', status: 'PENDING' };
    reconcileService.initiate.mockResolvedValue(mockWorkflow);

    await initiateWorkflow(req, res);

    expect(reconcileService.initiate).toHaveBeenCalledTimes(1);
    expect(reconcileService.initiate).toHaveBeenCalledWith('tenant-123', transactions, 'user-456');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: mockWorkflow });
  });

  it('should return 400 if transactions are not provided', async () => {
    req.body = {};

    await initiateWorkflow(req, res);

    expect(reconcileService.initiate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Provide an array of transactions.' });
  });

  it('should return 400 if transactions is not an array', async () => {
    req.body = { transactions: 'not-an-array' };

    await initiateWorkflow(req, res);

    expect(reconcileService.initiate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Provide an array of transactions.' });
  });

  it('should return 400 if transactions is an empty array', async () => {
    req.body = { transactions: [] };

    await initiateWorkflow(req, res);

    expect(reconcileService.initiate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Provide an array of transactions.' });
  });

  it('should handle service errors and return error status code', async () => {
    const transactions = [{ id: 'tx-1' }];
    req.body = { transactions };

    const error = new Error('Service validation failed');
    error.statusCode = 422;
    reconcileService.initiate.mockRejectedValue(error);

    await initiateWorkflow(req, res);

    expect(logger.error).toHaveBeenCalledWith('initiateWorkflow error:', 'Service validation failed');
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service validation failed' });
  });

  it('should handle general errors and return 500 status code', async () => {
    const transactions = [{ id: 'tx-1' }];
    req.body = { transactions };

    const error = new Error('Internal service error');
    reconcileService.initiate.mockRejectedValue(error);

    await initiateWorkflow(req, res);

    expect(logger.error).toHaveBeenCalledWith('initiateWorkflow error:', 'Internal service error');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Internal service error' });
  });
});
