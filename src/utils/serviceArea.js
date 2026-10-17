const DEFAULT_CENTER_LAT = 26.1445;
const DEFAULT_CENTER_LNG = 91.7362;
const DEFAULT_RADIUS_KM = 35;
const NORTH_GUWAHATI_MIN_LAT = 26.17;
const NORTH_GUWAHATI_CENTER_LAT = 26.20;
const NORTH_GUWAHATI_CENTER_LNG = 91.70;
const NORTH_GUWAHATI_RADIUS_KM = 16;

// Noida / Delhi NCR defaults
const NOIDA_CENTER_LAT = 28.5355;
const NOIDA_CENTER_LNG = 77.3910;
const NOIDA_RADIUS_KM = 30;

function finiteEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function configuredPincodes() {
  return new Set(String(process.env.NORTH_GUWAHATI_BLOCKED_PINCODES || "781030,781031")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter((value) => /^\d{6}$/.test(value)));
}

function pincodeFromAddress(value) {
  return String(value || "").match(/\b(\d{6})\b/)?.[1] || "";
}

function serviceAreaConfig() {
  return {
    id: "guwahati",
    name: "Guwahati, Assam",
    enabled: String(process.env.GUWAHATI_SERVICE_AREA_ENABLED || "true").toLowerCase() !== "false",
    centerLat: finiteEnv("GUWAHATI_SERVICE_AREA_CENTER_LAT", DEFAULT_CENTER_LAT),
    centerLng: finiteEnv("GUWAHATI_SERVICE_AREA_CENTER_LNG", DEFAULT_CENTER_LNG),
    radiusKm: Math.max(1, finiteEnv("GUWAHATI_SERVICE_AREA_RADIUS_KM", DEFAULT_RADIUS_KM)),
    northGuwahati: {
      enabled: String(process.env.NORTH_GUWAHATI_SERVICE_ENABLED || "false").toLowerCase() === "true",
      minLat: finiteEnv("NORTH_GUWAHATI_MIN_LAT", NORTH_GUWAHATI_MIN_LAT),
      centerLat: finiteEnv("NORTH_GUWAHATI_CENTER_LAT", NORTH_GUWAHATI_CENTER_LAT),
      centerLng: finiteEnv("NORTH_GUWAHATI_CENTER_LNG", NORTH_GUWAHATI_CENTER_LNG),
      radiusKm: Math.max(1, finiteEnv("NORTH_GUWAHATI_RADIUS_KM", NORTH_GUWAHATI_RADIUS_KM)),
      blockedPincodes: [...configuredPincodes()]
    },
    // Noida / Delhi NCR — enabled via env variable
    noida: {
      enabled: String(process.env.NOIDA_SERVICE_AREA_ENABLED || "false").toLowerCase() === "true",
      centerLat: finiteEnv("NOIDA_SERVICE_AREA_CENTER_LAT", NOIDA_CENTER_LAT),
      centerLng: finiteEnv("NOIDA_SERVICE_AREA_CENTER_LNG", NOIDA_CENTER_LNG),
      radiusKm: Math.max(1, finiteEnv("NOIDA_SERVICE_AREA_RADIUS_KM", NOIDA_RADIUS_KM))
    }
  };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateServiceArea(lat, lng, context = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const config = serviceAreaConfig();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
      || (latitude === 0 && longitude === 0)) {
    return { allowed: false, code: "SERVICE_AREA_LOCATION_REQUIRED", reason: "invalid_coordinates", config };
  }

  // Check Noida / Delhi NCR first (separate city, no North Guwahati rules apply)
  const noida = config.noida;
  if (noida.enabled) {
    const noidaDistance = distanceKm(latitude, longitude, noida.centerLat, noida.centerLng);
    if (noidaDistance <= noida.radiusKm) {
      return { allowed: true, code: "SERVICE_AREA_AVAILABLE", reason: "inside_noida_boundary", distanceKm: noidaDistance, city: "noida", config };
    }
  }

  if (!config.enabled) return { allowed: false, code: "SERVICE_AREA_UNAVAILABLE", reason: "area_disabled", config };
  const north = config.northGuwahati;
  const pincode = pincodeFromAddress(context.pincode || context.pinCode || context.address);
  if (!north.enabled && pincode && north.blockedPincodes.includes(pincode)) {
    return { allowed: false, code: "NORTH_GUWAHATI_UNAVAILABLE", reason: "north_guwahati_pincode_unavailable", pincode, config };
  }
  const northDistanceKm = distanceKm(latitude, longitude, north.centerLat, north.centerLng);
  if (!north.enabled && latitude >= north.minLat && northDistanceKm <= north.radiusKm) {
    return { allowed: false, code: "NORTH_GUWAHATI_UNAVAILABLE", reason: "north_guwahati_unavailable", distanceKm: northDistanceKm, config };
  }
  const distance = distanceKm(latitude, longitude, config.centerLat, config.centerLng);
  return {
    allowed: distance <= config.radiusKm,
    code: distance <= config.radiusKm ? "SERVICE_AREA_AVAILABLE" : "SERVICE_AREA_UNAVAILABLE",
    reason: distance <= config.radiusKm ? "inside_boundary" : "outside_boundary",
    distanceKm: distance,
    city: "guwahati",
    config
  };
}

module.exports = { serviceAreaConfig, validateServiceArea, distanceKm, pincodeFromAddress };
