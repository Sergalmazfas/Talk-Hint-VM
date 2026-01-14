import twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export interface AvailablePhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  country: string;
}

export interface PurchasedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}

function getTwilioClient(subaccountSid?: string, subaccountToken?: string) {
  if (subaccountSid && subaccountToken) {
    return twilio(subaccountSid, subaccountToken);
  }
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials not configured");
  }
  
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export async function searchAvailableNumbers(
  areaCode?: string,
  country: string = "US"
): Promise<AvailablePhoneNumber[]> {
  const client = getTwilioClient();
  
  const searchParams: any = {
    voiceEnabled: true,
    smsEnabled: true,
  };
  
  if (areaCode) {
    searchParams.areaCode = areaCode;
  }

  const numbers = await client.availablePhoneNumbers(country)
    .local
    .list(searchParams);

  return numbers.slice(0, 10).map(n => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality || "",
    region: n.region || "",
    country: country,
  }));
}

export async function purchasePhoneNumber(
  phoneNumber: string,
  webhookUrl: string,
  subaccountSid?: string,
  subaccountToken?: string
): Promise<PurchasedNumber> {
  const client = getTwilioClient(subaccountSid, subaccountToken);

  const incomingNumber = await client.incomingPhoneNumbers.create({
    phoneNumber: phoneNumber,
    voiceUrl: webhookUrl,
    voiceMethod: "POST",
    friendlyName: `TalkHint User Number`,
  });

  return {
    sid: incomingNumber.sid,
    phoneNumber: incomingNumber.phoneNumber,
    friendlyName: incomingNumber.friendlyName,
  };
}

export async function releasePhoneNumber(
  numberSid: string,
  subaccountSid?: string,
  subaccountToken?: string
): Promise<boolean> {
  const client = getTwilioClient(subaccountSid, subaccountToken);
  
  await client.incomingPhoneNumbers(numberSid).remove();
  return true;
}

/**
 * Configure webhook URL for incoming calls on a phone number
 * This is called automatically when assigning numbers to users
 */
export async function configureVoiceWebhook(
  numberSid: string,
  webhookUrl: string,
  subaccountSid?: string,
  subaccountToken?: string
): Promise<{ success: boolean; phoneNumber?: string; error?: string }> {
  try {
    const client = getTwilioClient(subaccountSid, subaccountToken);
    
    const updated = await client.incomingPhoneNumbers(numberSid).update({
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
      statusCallback: `${webhookUrl.replace('/twilio/voice', '/twilio/status')}`,
      statusCallbackMethod: "POST",
    });
    
    console.log(`[Twilio] Configured webhook for ${updated.phoneNumber}: ${webhookUrl}`);
    
    return {
      success: true,
      phoneNumber: updated.phoneNumber,
    };
  } catch (error: any) {
    console.error(`[Twilio] Failed to configure webhook for ${numberSid}:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get phone number SID by phone number
 */
export async function getNumberSidByPhone(
  phoneNumber: string
): Promise<string | null> {
  try {
    const client = getTwilioClient();
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
    
    if (numbers.length > 0) {
      return numbers[0].sid;
    }
    return null;
  } catch (error: any) {
    console.error(`[Twilio] Failed to lookup number ${phoneNumber}:`, error.message);
    return null;
  }
}

/**
 * Configure webhook by phone number (not SID)
 */
export async function configureWebhookByPhone(
  phoneNumber: string,
  webhookUrl: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  try {
    const client = getTwilioClient();
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
    
    if (numbers.length === 0) {
      return { success: false, error: "Phone number not found in Twilio account" };
    }
    
    const numberSid = numbers[0].sid;
    
    const updated = await client.incomingPhoneNumbers(numberSid).update({
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
      statusCallback: `${webhookUrl.replace('/twilio/voice', '/twilio/status')}`,
      statusCallbackMethod: "POST",
    });
    
    console.log(`[Twilio] Configured webhook for ${updated.phoneNumber} (${numberSid}): ${webhookUrl}`);
    
    return {
      success: true,
      sid: numberSid,
    };
  } catch (error: any) {
    console.error(`[Twilio] Failed to configure webhook for ${phoneNumber}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Configure webhooks for all numbers in the pool
 * Used for initial setup or when deployment URL changes
 */
export async function configureAllPoolWebhooks(
  numbers: Array<{ twilioSid: string; subaccountSid?: string; subaccountToken?: string; twilioNumber: string }>,
  baseUrl: string
): Promise<{ configured: number; failed: number; errors: string[] }> {
  const webhookUrl = `${baseUrl}/twilio/voice`;
  let configured = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const num of numbers) {
    const result = await configureVoiceWebhook(
      num.twilioSid,
      webhookUrl,
      num.subaccountSid || undefined,
      num.subaccountToken || undefined
    );
    
    if (result.success) {
      configured++;
    } else {
      failed++;
      errors.push(`${num.twilioNumber}: ${result.error}`);
    }
  }
  
  console.log(`[Twilio] Webhook configuration complete: ${configured} configured, ${failed} failed`);
  
  return { configured, failed, errors };
}
