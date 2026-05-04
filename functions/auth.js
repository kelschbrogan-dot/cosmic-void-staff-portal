const TARGET_API = "https://script.google.com/macros/s/AKfycbyl0_Aq4jBLmMKTqXORLxb6AGJ0xKOYti-DITn6Ix0NbnSSgPDKRSxQKAZ24sz_0DTG/exec";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-api-key"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    let body = {};
    if (request.method === "GET") {
      const url = new URL(request.url);
      url.searchParams.forEach((value, key) => {
        body[key] = value;
      });
    } else {
      try {
        body = await request.json();
      } catch (error) {
        body = {};
      }
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    // Try to capture API key from multiple header cases
    const apiKey = request.headers.get("x-api-key") || 
                   request.headers.get("X-API-Key") || 
                   request.headers.get("X-API-KEY") ||
                   body.apiKey;
    
    if (apiKey) {
      headers.set("x-api-key", apiKey);
      headers.set("X-API-Key", apiKey);
    }

    const response = await fetch(TARGET_API, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "follow"
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { error: "BAD_RESPONSE", raw: text };
    }

    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: responseHeaders
    });
  }
};