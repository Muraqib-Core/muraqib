import url from "node:url";

const osvUrl = process.env.OSV_API_URL ?? "https://api.osv.dev/v1/query";
const parsedUrl = new url.URL(osvUrl);

export const osvConfig = {
  protocol: parsedUrl.protocol,
  hostname: parsedUrl.hostname,
  port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
  path: parsedUrl.pathname + parsedUrl.search,
  userAgent: "Muraqib-Audit-Tool/1.0",
  family: 4, 
  timeout: Number(process.env.OSV_TIMEOUT) || 10000,
};