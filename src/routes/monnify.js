const express = require('express');
const axios = require('axios');

const router = express.Router();

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const MONNIFY_SOURCE_ACCOUNT_NUMBER = process.env.MONNIFY_SOURCE_ACCOUNT_NUMBER;

let cachedAccessToken = null;
let tokenExpiryMs = 0;

const FINTECH_BANKS = [
  { name: 'OPay', code: '999992', isFintech: true },
  { name: 'PalmPay', code: '999991', isFintech: true },
  { name: 'MoniePoint', code: '50515', isFintech: true },
  { name: 'Kuda Bank', code: '50211', isFintech: true },
  { name: 'UBA Bank', code: '50201', isFintech: true },
  { name: 'ACCESS Bank', code: '50291', isFintech: true },
  { name: 'WEMA Bank', code: '50202', isFintech: true },
  { name: 'FIRST BANK', code: '59202', isFintech: true },
  { name: 'Carbon', code: '50457', isFintech: true }
];

function checkMonnifyConfig(req, res, next) {
  if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY) {
    return res.status(500).json({
      status: false,
      message: 'Monnify credentials not configured. Set MONNIFY_API_KEY and MONNIFY_SECRET_KEY in .env'
    });
  }
  next();
}

function checkMonnifyCollectionConfig(req, res, next) {
  if (!MONNIFY_CONTRACT_CODE) {
    return res.status(500).json({
      status: false,
      message: 'Monnify contract code not configured. Set MONNIFY_CONTRACT_CODE in .env'
    });
  }
  next();
}

function makePaymentReference() {
  return `MON-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function makeTransferReference() {
  return `TRF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function getMonnifyAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiryMs) {
    return cachedAccessToken;
  }

  const authValue = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');
  const response = await axios.post(
    `${MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    {
      headers: {
        Authorization: `Basic ${authValue}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.data?.requestSuccessful || !response.data?.responseBody?.accessToken) {
    throw new Error(response.data?.responseMessage || 'Failed to authenticate with Monnify');
  }

  const accessToken = response.data.responseBody.accessToken;
  const expiresIn = Number(response.data.responseBody.expiresIn || 3600);
  cachedAccessToken = accessToken;
  tokenExpiryMs = now + Math.max(60, expiresIn - 60) * 1000;

  return cachedAccessToken;
}

router.get('/banks', checkMonnifyConfig, async (req, res) => {
  try {
    const token = await getMonnifyAccessToken();
    const response = await axios.get(`${MONNIFY_BASE_URL}/api/v1/banks`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.data?.requestSuccessful || !Array.isArray(response.data?.responseBody)) {
      return res.status(400).json({
        status: false,
        message: response.data?.responseMessage || 'Failed to fetch banks from Monnify'
      });
    }

    const monnifyBanks = response.data.responseBody.map((bank) => ({
      name: bank.name,
      code: String(bank.code),
      isFintech: false
    }));

    monnifyBanks.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      status: true,
      message: 'Banks fetched successfully',
      data: monnifyBanks
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Monnify banks error:', errorData);
    return res.status(500).json({
      status: false,
      message: errorData?.responseMessage || errorData?.message || 'Error fetching banks from Monnify',
      error: process.env.NODE_ENV === 'development' ? errorData : undefined
    });
  }
});

router.post('/verify', checkMonnifyConfig, async (req, res) => {
  const { account_number, bank_code } = req.body;

  if (!account_number || !bank_code) {
    return res.status(400).json({
      status: false,
      message: 'Account number and bank code are required'
    });
  }

  if (!/^\d{10}$/.test(String(account_number))) {
    return res.status(400).json({
      status: false,
      message: 'Account number must be exactly 10 digits'
    });
  }

  const fintechBank = FINTECH_BANKS.find((bank) => String(bank.code) === String(bank_code));
  if (fintechBank) {
    return res.json({
      status: true,
      message: 'Account resolved successfully (Fintech - Test Mode)',
      data: {
        account_number: String(account_number),
        account_name: `${fintechBank.name} Test User`,
        accountName: `${fintechBank.name} Test User`,
        bank_code: String(bank_code),
        bankCode: String(bank_code),
        bank_name: fintechBank.name,
        is_fintech: true,
        is_mock: true
      }
    });
  }

  try {
    const token = await getMonnifyAccessToken();
    const response = await axios.get(`${MONNIFY_BASE_URL}/api/v1/disbursements/account/validate`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        accountNumber: String(account_number),
        bankCode: String(bank_code)
      }
    });

    if (!response.data?.requestSuccessful) {
      return res.json({
        status: false,
        message: response.data?.responseMessage || 'Account verification failed'
      });
    }

    const body = response.data.responseBody || {};
    return res.json({
      status: true,
      message: 'Account resolved successfully',
      data: {
        account_number: body.accountNumber || String(account_number),
        account_name: body.accountName || '',
        accountName: body.accountName || '',
        bank_code: body.bankCode || String(bank_code),
        bankCode: body.bankCode || String(bank_code),
        is_fintech: false,
        is_mock: false
      },
      responseBody: body
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Monnify verify error:', errorData);
    return res.json({
      status: false,
      message: errorData?.responseMessage || errorData?.message || 'Error verifying account',
      error: errorData
    });
  }
});

router.post('/initialize', checkMonnifyConfig, checkMonnifyCollectionConfig, async (req, res) => {
  const { amount, email, name } = req.body;

  if (!amount || Number(amount) <= 0 || !email) {
    return res.status(400).json({
      status: false,
      message: 'Amount and email are required to initialize payment'
    });
  }

  const paymentReference = makePaymentReference();
  const redirectUrl = process.env.MONNIFY_REDIRECT_URL || 'http://localhost:3001/receive.html';

  try {
    const token = await getMonnifyAccessToken();
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/api/v1/merchant/transactions/init-transaction`,
      {
        amount: Number(amount),
        customerName: name || 'PalmPay User',
        customerEmail: email,
        paymentReference,
        paymentDescription: 'Add money to PalmPay demo wallet',
        currencyCode: 'NGN',
        contractCode: MONNIFY_CONTRACT_CODE,
        redirectUrl
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data?.requestSuccessful || !response.data?.responseBody) {
      return res.status(400).json({
        status: false,
        message: response.data?.responseMessage || 'Failed to initialize Monnify payment'
      });
    }

    const body = response.data.responseBody;
    return res.json({
      status: true,
      message: 'Payment initialized',
      data: {
        reference: body.transactionReference || body.paymentReference || paymentReference,
        authorization_url: body.checkoutUrl || body.paymentLink || ''
      },
      responseBody: body
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Monnify initialize error:', errorData);
    return res.status(500).json({
      status: false,
      message: errorData?.responseMessage || errorData?.message || 'Failed to initialize Monnify payment',
      error: errorData
    });
  }
});

router.get('/verify-transaction', checkMonnifyConfig, async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({
      status: false,
      message: 'Reference query parameter is required'
    });
  }

  try {
    const token = await getMonnifyAccessToken();
    let body = null;

    try {
      const txResponse = await axios.get(
        `${MONNIFY_BASE_URL}/api/v2/transactions/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      body = txResponse.data?.responseBody || null;
    } catch {
      const queryResponse = await axios.get(
        `${MONNIFY_BASE_URL}/api/v1/merchant/transactions/query`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: { paymentReference: reference }
        }
      );
      body = queryResponse.data?.responseBody || null;
    }

    const normalizedStatus = String(
      body?.paymentStatus ||
      body?.status ||
      body?.transactionStatus ||
      'PENDING'
    ).toUpperCase();

    return res.json({
      status: true,
      message: 'Transaction checked',
      data: {
        status: normalizedStatus === 'PAID' || normalizedStatus === 'SUCCESS' || normalizedStatus === 'SUCCESSFUL'
          ? 'success'
          : 'pending',
        rawStatus: normalizedStatus
      },
      responseBody: body
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Monnify verify transaction error:', errorData);
    return res.status(500).json({
      status: false,
      message: errorData?.responseMessage || errorData?.message || 'Failed to verify Monnify transaction',
      error: errorData
    });
  }
});

router.post('/transfer', checkMonnifyConfig, async (req, res) => {
  const {
    amount,
    bankCode,
    accountNumber,
    accountName,
    narration
  } = req.body || {};

  if (!amount || Number(amount) <= 0 || !bankCode || !accountNumber) {
    return res.status(400).json({
      status: false,
      message: 'amount, bankCode and accountNumber are required'
    });
  }

  if (!/^\d{10}$/.test(String(accountNumber))) {
    return res.status(400).json({
      status: false,
      message: 'Account number must be exactly 10 digits'
    });
  }

  if (!MONNIFY_SOURCE_ACCOUNT_NUMBER) {
    return res.status(500).json({
      status: false,
      message: 'Monnify source account not configured. Set MONNIFY_SOURCE_ACCOUNT_NUMBER in .env'
    });
  }

  const reference = makeTransferReference();

  try {
    const token = await getMonnifyAccessToken();
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/api/v2/disbursements/single`,
      {
        amount: Number(amount),
        reference,
        narration: narration || 'Transfer from PalmPay demo app',
        destinationBankCode: String(bankCode),
        destinationAccountNumber: String(accountNumber),
        currency: 'NGN',
        sourceAccountNumber: String(MONNIFY_SOURCE_ACCOUNT_NUMBER)
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data?.requestSuccessful) {
      return res.status(400).json({
        status: false,
        message: response.data?.responseMessage || 'Monnify transfer failed',
        error: response.data
      });
    }

    return res.json({
      status: true,
      message: 'Transfer submitted successfully',
      data: {
        reference,
        accountName: accountName || '',
        amount: Number(amount)
      },
      responseBody: response.data?.responseBody
    });
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error('Monnify transfer error:', errorData);
    const providerMessage = errorData?.responseMessage || errorData?.message || '';
    const message = /does not belong to merchant/i.test(providerMessage)
      ? 'The Monnify source account is not owned by this merchant. Set MONNIFY_SOURCE_ACCOUNT_NUMBER to a valid account linked to these Monnify credentials.'
      : providerMessage || 'Failed to process transfer';
    return res.status(500).json({
      status: false,
      message,
      error: errorData
    });
  }
});

module.exports = router;
