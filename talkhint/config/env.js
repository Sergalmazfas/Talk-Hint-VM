module.exports = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  PORT: process.env.PORT || 3000,
  
  isConfigured: function() {
    return !!this.OPENAI_API_KEY;
  },

  validate: function() {
    const missing = [];
    if (!this.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    return missing;
  }
};
