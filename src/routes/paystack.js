const express = require('express');
const axios = require('axios');
const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Middleware to check if Paystack key is configured
const checkPaystackKey = (req, res, next) => {
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      status: false,
      message: 'Paystack secret key not configured. Please set PAYSTACK_SECRET_KEY in your .env file'
    });
  }
  next();
};

/**
 * GET /api/paystack/banks
 * Fetch all Nigerian banks from Paystack
 */
router.get('/banks', checkPaystackKey, async (req, res) => {
  try {
    const response = await axios.get(`${PAYSTACK_BASE_URL}/bank`, {
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      params: {
        country: 'nigeria',
        use_cursor: true,
        perPage: 100
      }
    });

    if (response.data.status) {
      // Sort banks alphabetically by name
      const banks = response.data.data.sort((a, b) => 
        a.name.localeCompare(b.name)
      );
      
      res.json({
        status: true,
        message: 'Banks fetched successfully',
        data: banks
      });
    } else {
      res.status(400).json({
        status: false,
        message: response.data.message || 'Failed to fetch banks'
      });
    }
  } catch (error) {
    console.error('Paystack banks error:', error.response?.data || error.message);
    res.status(500).json({
      status: false,
      message: error.response?.data?.message || 'Error fetching banks from Paystack',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/paystack/verify
 * Resolve account number with bank code
 * Body: { account_number: string, bank_code: string }
 * Handles both Paystack banks and fintech banks
 */
router.post('/verify', checkPaystackKey, async (req, res) => {
  const { account_number, bank_code } = req.body;

  // Validation
  if (!account_number || !bank_code) {
    return res.status(400).json({
      status: false,
      message: 'Account number and bank code are required'
    });
  }

  // Validate account number format (10 digits for Nigerian banks)
  if (!/^\d{10}$/.test(account_number)) {
    return res.status(400).json({
      status: false,
      message: 'Account number must be exactly 10 digits'
    });
  }

  // Fintech bank codes mapping with specific mock account names
  const FINTECH_BANKS = {
    '999992': { name: 'OPay', mockName: 'Opay Test User' },
    '999991': { name: 'PalmPay', mockName: 'Palmpay Test User' },
    '50515': { name: 'MoniePoint', mockName: 'MoniePoint Test User' },
    '50211': { name: 'Kuda Bank', mockName: 'Kuda Test User' },
    '50457': { name: 'Carbon', mockName: 'Carbon Test User' },
    '51211': { name: 'UBA Bank', mockName: 'UBA Test User' }
  };

  // Check if it's a fintech bank
  const isFintechBank = FINTECH_BANKS.hasOwnProperty(bank_code);

  if (isFintechBank) {
    // For fintech banks, return mock account name immediately (no API call to avoid limits)
    const fintechBank = FINTECH_BANKS[bank_code];

    return res.json({
      status: true,
      message: 'Account resolved successfully (Fintech - Test Mode)',
      data: {
        account_number: account_number,
        account_name: fintechBank.mockName,
        bank_id: bank_code,
        bank_name: fintechBank.name,
        is_fintech: true,
        is_mock: true
      }
    });
  }

  // For regular Paystack banks, call Paystack API
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/bank/resolve`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        params: {
          account_number: account_number,
          bank_code: bank_code
        }
      }
    );

    // Paystack returns { status: true, data: { ... } } on success
    if (response.data.status) {
      return res.json({
        status: true,
        message: 'Account resolved successfully',
        data: {
          account_number: response.data.data.account_number,
          account_name: response.data.data.account_name,
          bank_id: response.data.data.bank_id,
          is_fintech: false,
          is_mock: false
        }
      });
    }

    // Pass through any error response from Paystack (return 200 to avoid browser network errors)
    return res.json({
      status: false,
      message: response.data.message || 'Failed to resolve account name from Paystack',
      error: response.data
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };

    console.error('Paystack verify error:', errorData);

    return res.json({
      status: false,
      message: errorData.message || 'Error resolving account',
      error: errorData
    });
  }
});

/**
 * POST /api/paystack/initialize
 * Initialize a Paystack payment to receive money into the demo account.
 * Body: { amount: number, email: string, name?: string }
 */
router.post('/initialize', checkPaystackKey, async (req, res) => {
  const { amount, email } = req.body;

  if (!amount || amount <= 0 || !email) {
    return res.status(400).json({
      status: false,
      message: 'Amount and email are required to initialize a payment'
    });
  }

  try {
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        amount: Math.round(amount * 100), // kobo
        email,
        callback_url: process.env.PAYSTACK_CALLBACK_URL || 'http://localhost:3000/index.html'
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      status: true,
      message: 'Payment initialized',
      data: response.data.data
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Paystack initialize error:', errorData);
    return res.status(500).json({
      status: false,
      message: errorData.message || 'Failed to initialize payment',
      error: errorData
    });
  }
});

/**
 * GET /api/paystack/verify-transaction
 * Verify a Paystack transaction by reference
 */
router.get('/verify-transaction', checkPaystackKey, async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({
      status: false,
      message: 'Reference query parameter is required'
    });
  }

  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      status: true,
      message: 'Transaction verified',
      data: response.data.data
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Paystack transaction verify error:', errorData);
    return res.status(500).json({
      status: false,
      message: errorData.message || 'Failed to verify transaction',
      error: errorData
    });
  }
});

/**
 * Helper function to generate mock account names for test mode fallback
 * Uses account number to generate consistent names (same account = same name)
 */
function generateMockAccountName(accountNumber, bankName) {
  // Common Nigerian names for realistic mock data
  const firstNames = ['Ade', 'Chukwu', 'Ibrahim', 'Musa', 'Oluwaseun', 'Fatima', 'Amina', 'Emeka', 'Ngozi', 'Kemi', 'John', 'Mary', 'David', 'Grace'];
  const lastNames = ['Adebayo', 'Okafor', 'Mohammed', 'Ibrahim', 'Okoro', 'Adekunle', 'Bello', 'Okafor', 'Nwankwo', 'Adeyemi', 'Smith', 'Johnson', 'Williams', 'Brown'];
  
  // Use account number to generate consistent name (same account = same name)
  const seed = parseInt(accountNumber.slice(-4)) % 100;
  const firstName = firstNames[seed % firstNames.length];
  const lastName = lastNames[Math.floor(seed / 10) % lastNames.length];
  
  return `${firstName} ${lastName}`.toUpperCase();
}

module.exports = router;

