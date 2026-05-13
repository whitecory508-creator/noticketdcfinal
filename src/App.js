import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import "leaflet/dist/leaflet.css";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";

const DC_CAMERA_API =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/47/query?f=json&where=1%3D1&outFields=ENFORCEMENT_SPACE_CODE,LOCATION_DESCRIPTION,SITE_CODE,ACTIVE_STATUS,CAMERA_STATUS,DEVICE_MOBILITY,ENFORCEMENT_TYPE,SPEED_LIMIT,CAMERA_LATITUDE,CAMERA_LONGITUDE,WARD,ANC,SMD,OBJECTID";

const ZYLA_FUEL_API_KEY = "13700|ZWRKO46cXaIKsyYbikiXF1hvTlfYl91A7AykXNnp";
const ZYLA_FUEL_PRICE_URL =
  "https://zylalabs.com/api/5925/fuel+rate+insights+api/7820/price";
const ZYLA_STATION_DATA_URL =
  "https://zylalabs.com/api/5925/fuel+rate+insights+api/23316/station+data";

const DEFAULT_GAS_ZIP = "20001";

const REPORT_TYPES = [
  "Accident",
  "Police Ahead",
  "Ice / Road Hazard",
  "Disabled Vehicle",
  "Heavy Traffic",
  "Construction",
  "Flooding",
  "Road Closed",
  "Speed Trap",
  "Other Hazard",
];

const DC_TRAFFIC_LAWS = [
  ["🛑 Full Stops Required", "Rolling through a stop sign can still count as a violation. Stop sign cameras may issue tickets if the vehicle does not fully stop."],
  ["📸 Speed Cameras", "DC speed cameras can issue tickets when drivers exceed the posted speed limit. Always slow down before camera zones."],
  ["🚦 Red Light Cameras", "Entering an intersection after the light turns red can trigger a camera ticket."],
  ["🚌 Bus Lane Enforcement", "Driving, stopping, or parking in a bus lane during restricted hours can result in a ticket."],
  ["↪️ No Turn on Red", "Many DC intersections do not allow right turns on red. Always check posted signs before turning."],
  ["🏫 School Zones", "School zone speed limits may drop during posted hours. Slow down even if students are not visible."],
  ["🚧 Blocking the Box", "Do not enter an intersection unless you can fully clear it. Blocking the box can lead to a ticket."],
  ["📱 Hands-Free Law", "Holding or using your phone while driving can result in fines. Use hands-free options only."],
  ["🚲 Bike Lanes", "Stopping, parking, or driving in bike lanes can result in tickets, especially downtown."],
  ["🚗 Double Parking", "Double parking in DC can lead to expensive fines and can block traffic or bike lanes."],
  ["🚐 Mobile Enforcement", "DC may use mobile camera units and enforcement vehicles, not just fixed cameras."],
  ["↔️ Cameras May Face Multiple Directions", "Some DC traffic cameras monitor more than one direction, so do not assume only one side is enforced."],
  ["🚶 Crosswalk Safety", "Drivers must yield to pedestrians in crosswalks. Failing to yield can result in a traffic violation."],
  ["🚫 Do Not Block Bike Boxes", "Some intersections have bike boxes near the stop line. Stopping inside them may lead to enforcement."],
  ["🚛 Truck Restrictions", "Some DC streets restrict trucks or commercial vehicles. Always check posted signs."],
];

const SUBSCRIPTION_PLANS = [
  {
    name: "Monthly Driver Plan",
    price: "$2.99/month",
    detail: "First month free, then $2.99 per month for daily No Ticket DC use.",
    productId: "noticketdc_monthly_299",
  },
  {
    name: "3-Day Visitor Pass",
    price: "$0.99",
    detail: "Perfect for tourists, visitors, and short trips in Washington DC.",
    productId: "noticketdc_3day_099",
  },
  {
    name: "Yearly Driver Plan",
    price: "$29.99/year",
    detail: "Best value for regular DC drivers who use the app all year.",
    productId: "noticketdc_yearly_2999",
  },
  {
    name: "Fleet Plan",
    price: "$39.99/month",
    detail: "For businesses with up to 20 vehicles.",
    productId: "noticketdc_fleet_3999",
  },
];

const APP_EMAIL = "info@noticketdc.com";

const APP_URLS = {
  privacy: "https://www.noticketdc.com/privacy-policy.html",
  terms: "https://www.noticketdc.com/terms-of-service-noticket-dc.html",
  disclaimer: "https://www.noticketdc.com/disclaimer-noticket-dc.html",
  refund: "https://www.noticketdc.com/refund-policy-noticket-dc.html",
  contact: `mailto:${APP_EMAIL}`,
};

const PREF_KEYS = {
  voiceEnabled: "noticket_voice_enabled",
  showSpeed: "noticket_show_speed",
  showRedLight: "noticket_show_red_light",
  showStopSign: "noticket_show_stop_sign",
  showOther: "noticket_show_other",
  showAlertHistory: "noticket_show_alert_history",
  showCurrentStatus: "noticket_show_current_status",
  showNearestCameras: "noticket_show_nearest_cameras",
  showGasPrices: "noticket_show_gas_prices",
  gasZip: "noticket_gas_zip",
};

const ALERT_DISTANCE_FEET = 500;
const ALERT_DISTANCE_METERS = ALERT_DISTANCE_FEET / 3.28084;

const DC_BOUNDS = {
  minLat: 38.7916,
  maxLat: 38.9955,
  minLng: -77.1198,
  maxLng: -76.9094,
};

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function metersToFeet(meters) {
  return meters * 3.28084;
}

function formatDistance(meters) {
  if (!isFinite(meters)) return "--";
  const feet = metersToFeet(meters);
  if (feet < 528) return `${Math.round(feet)} ft`;
  return `${(feet / 5280).toFixed(2)} mi`;
}

function getHeadingDegrees(coords) {
  const heading =
    coords && typeof coords.heading === "number" ? coords.heading : null;
  return Number.isFinite(heading) ? heading : null;
}

function getCardinalDirection(heading) {
  if (!Number.isFinite(heading)) return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(heading / 45) % 8];
}

function bearingBetweenPoints(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda1 = toRadians(lon1);
  const lambda2 = toRadians(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function smallestAngleDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function isLikelyAhead(userHeading, bearingToCamera) {
  if (!Number.isFinite(userHeading) || !Number.isFinite(bearingToCamera)) {
    return true;
  }
  return smallestAngleDifference(userHeading, bearingToCamera) <= 75;
}

function isInsideDc(lat, lng) {
  return (
    lat >= DC_BOUNDS.minLat &&
    lat <= DC_BOUNDS.maxLat &&
    lng >= DC_BOUNDS.minLng &&
    lng <= DC_BOUNDS.maxLng
  );
}

function toBool(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  return value === "true";
}

async function savePref(key, value) {
  await Preferences.set({ key, value: String(value) });
}

async function loadPrefs() {
  const entries = await Promise.all(
    Object.values(PREF_KEYS).map((key) => Preferences.get({ key }))
  );
  const result = {};
  Object.values(PREF_KEYS).forEach((key, index) => {
    result[key] = entries[index]?.value ?? null;
  });
  return result;
}

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

async function requestLocationPermission() {
  const permissions = await Geolocation.requestPermissions();
  return (
    permissions.location === "granted" ||
    permissions.coarseLocation === "granted"
  );
}

async function requestNotificationPermission() {
  const permission = await LocalNotifications.requestPermissions();
  return permission.display === "granted";
}

async function stopSpeaking() {
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch (error) {
    console.error("Stop speech error:", error);
  }
}

function unlockSpeech() {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const unlock = new SpeechSynthesisUtterance("Voice alerts enabled");
    unlock.lang = "en-US";
    unlock.rate = 1;
    unlock.pitch = 1;
    unlock.volume = 0;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(unlock);
  } catch (error) {
    console.error("Unlock speech error:", error);
  }
}

async function speakText(text) {
  if (!text) return;

  try {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.error("Speech synthesis not available.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.volume = 1;
    utterance.pitch = 1;

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 150);
  } catch (error) {
    console.error("Speech error:", error);
  }
}

async function fireLocalNotification(title, body, id) {
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at: new Date(Date.now() + 250) },
        },
      ],
    });
  } catch (error) {
    console.error("Notification error", error);
  }
}

function getCameraAlertText(camera) {
  if (camera.type === "speed") {
    return "Approaching a speed camera in 500 feet. Follow posted speed limit.";
  }
  if (camera.type === "red_light") {
    return "Approaching a red light camera in 500 feet.";
  }
  if (camera.type === "stop_sign") {
    return "Approaching stop sign camera in 500 feet.";
  }
  return "Approaching a traffic enforcement camera in 500 feet.";
}

function getCameraColor(camera) {
  if (camera.type === "speed") return "#ef4444";
  if (camera.type === "red_light") return "#f59e0b";
  if (camera.type === "stop_sign") return "#8b5cf6";
  return "#3b82f6";
}

function openExternal(url) {
  window.location.href = url;
}

function buildSuggestionMailto(name, email, suggestion) {
  const subject = encodeURIComponent("NoTicket DC App Suggestion");
  const body = encodeURIComponent(
    `Name: ${name || ""}\nEmail: ${email || ""}\n\nSuggestion:\n${suggestion || ""}`
  );
  return `mailto:${APP_EMAIL}?subject=${subject}&body=${body}`;
}

function SectionCard({ title, children, accent = "#333", centered = false }) {
  return (
    <div
      style={{
        background: "#171717",
        border: `1px solid ${accent}`,
        borderRadius: 18,
        padding: 20,
        marginTop: 20,
        boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
        textAlign: centered ? "center" : "left",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 14, fontSize: 22 }}>{title}</h2>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label
      style={{
        display: "block",
        marginBottom: 10,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginRight: 8 }}
      />
      {label}
    </label>
  );
}

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && Array.isArray(center)) {
      map.setView(center, zoom ?? map.getZoom(), { animate: true });
    }
  }, [center, zoom, map]);
  return null;
}

function TrafficActionButton({ icon, label, onClick, active = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#16a34a" : "#dc2626",
        color: "white",
        border: active ? "1px solid #22c55e" : "1px solid #ef4444",
        padding: "14px 18px",
        borderRadius: 14,
        fontSize: 16,
        fontWeight: "bold",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        justifyContent: "center",
        boxShadow: active
          ? "0 8px 18px rgba(34,197,94,0.25)"
          : "0 8px 18px rgba(220,38,38,0.25)",
      }}
    >
      <span style={{ fontSize: 24, minWidth: 28, textAlign: "center" }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function getBestGasPrice(station) {
  const prices = [
    station.regular,
    station.midGrade,
    station.premium,
    station.diesel,
  ].filter((price) => Number.isFinite(price));
  if (!prices.length) return null;
  return Math.min(...prices);
}

function money(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `$${value.toFixed(3)}`;
}

function normalizePrice(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function getStationId(item) {
  return (
    item?.station_id ||
    item?.stationId ||
    item?.id ||
    item?.site_id ||
    item?.uuid ||
    null
  );
}

function getGasMarkerColor(station, allStations) {
  const price = getBestGasPrice(station);
  const prices = allStations
    .map(getBestGasPrice)
    .filter((value) => Number.isFinite(value));

  if (!Number.isFinite(price) || prices.length < 2) return "#facc15";

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;

  if (range <= 0.01) return "#16a34a";
  if (price <= min + range * 0.33) return "#16a34a";
  if (price >= min + range * 0.67) return "#dc2626";
  return "#facc15";
}

function parseLatLng(item) {
  const lat = Number(
    item?.lat ||
      item?.latitude ||
      item?.station_lat ||
      item?.stationLat ||
      item?.geo_lat ||
      item?.location?.lat ||
      item?.coordinates?.lat
  );
  const lng = Number(
    item?.lng ||
      item?.lon ||
      item?.longitude ||
      item?.station_lng ||
      item?.stationLng ||
      item?.geo_lng ||
      item?.location?.lng ||
      item?.location?.lon ||
      item?.coordinates?.lng ||
      item?.coordinates?.lon
  );

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function normalizeZylaGasData(payload, userLat, userLng) {
  const gasType = String(payload?.gas_type || payload?.type || "regular").toLowerCase();
  const raw =
    payload?.gas_prices ||
    payload?.result?.gas_prices ||
    payload?.result?.stations ||
    payload?.result?.data ||
    payload?.result?.prices ||
    payload?.result ||
    payload?.stations ||
    payload?.data ||
    payload?.prices ||
    [];

  const list = Array.isArray(raw) ? raw : [raw];

  return list
    .filter((item) => item && (getStationId(item) || item?.price || item?.regular || item?.gas_price))
    .map((item, index) => {
      const { lat, lng } = parseLatLng(item);
      const priceFromResponse = normalizePrice(item?.price || item?.gas_price || item?.fuel_price);

      const regular = normalizePrice(
        item?.regular ||
          item?.regular_price ||
          item?.regularPrice ||
          (gasType.includes("regular") ? priceFromResponse : null)
      );
      const midGrade = normalizePrice(
        item?.midgrade ||
          item?.mid_grade ||
          item?.midGrade ||
          item?.midgrade_price ||
          item?.midPrice ||
          (gasType.includes("mid") ? priceFromResponse : null)
      );
      const premium = normalizePrice(
        item?.premium ||
          item?.premium_price ||
          item?.premiumPrice ||
          (gasType.includes("premium") ? priceFromResponse : null)
      );
      const diesel = normalizePrice(
        item?.diesel ||
          item?.diesel_price ||
          item?.dieselPrice ||
          (gasType.includes("diesel") ? priceFromResponse : null)
      );

      const stationId = getStationId(item) || `zyla-gas-${index}`;

      return {
        id: stationId,
        stationId,
        name:
          item?.name ||
          item?.station ||
          item?.station_name ||
          item?.stationName ||
          item?.brand ||
          `Gas Station ${stationId}`,
        address:
          item?.address ||
          item?.station_address ||
          item?.stationAddress ||
          item?.location ||
          item?.city ||
          "Address loading from Zyla station data...",
        regular,
        midGrade,
        premium,
        diesel,
        lat,
        lng,
        raw: item,
        distanceMeters:
          Number.isFinite(lat) && Number.isFinite(lng)
            ? distanceInMeters(userLat, userLng, lat, lng)
            : Infinity,
      };
    })
    .filter((station) => getBestGasPrice(station) !== null);
}

function formatStationAddress(address) {
  if (!address) return "Address not available";
  if (typeof address === "string") return address;

  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

async function fetchZylaStationDetails(station) {
  if (!station?.stationId) return station;

  try {
    const url = `${ZYLA_STATION_DATA_URL}?station_id=${encodeURIComponent(
      station.stationId
    )}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ZYLA_FUEL_API_KEY}`,
        Accept: "application/json",
      },
    });

    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.success === false)
      return station;

    const data = payload?.data || payload?.result || payload?.station || payload;
    const { lat, lng } = parseLatLng(data);
    const address = formatStationAddress(
      data?.address || data?.station_address || data?.location
    );

    return {
      ...station,
      name: data?.name || data?.station_name || data?.brand || station.name,
      address: address || station.address,
      lat: Number.isFinite(lat) ? lat : station.lat,
      lng: Number.isFinite(lng) ? lng : station.lng,
      phone: data?.phone || station.phone || "",
      rating: data?.rating?.overall || station.rating || null,
      openStatus: data?.open_status || station.openStatus || "",
      amenities: Array.isArray(data?.amenities)
        ? data.amenities
        : station.amenities || [],
      distanceMeters:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? station.distanceMeters
          : station.distanceMeters,
    };
  } catch (error) {
    console.error("Zyla station data error:", error);
    return station;
  }
}

async function enrichGasStationsWithZylaDetails(stations, userLat, userLng) {
  const limited = stations.slice(0, 10);
  const enriched = await Promise.all(limited.map(fetchZylaStationDetails));

  return [
    ...enriched.map((station) => {
      if (Number.isFinite(station.lat) && Number.isFinite(station.lng)) {
        return {
          ...station,
          distanceMeters: distanceInMeters(
            userLat,
            userLng,
            station.lat,
            station.lng
          ),
        };
      }
      return station;
    }),
    ...stations.slice(10),
  ];
}

async function getZipFromLocation(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&addressdetails=1`
    );
    const data = await response.json();
    const postcode = data?.address?.postcode;
    return postcode ? String(postcode).split("-")[0] : DEFAULT_GAS_ZIP;
  } catch (error) {
    console.error("ZIP lookup error:", error);
    return DEFAULT_GAS_ZIP;
  }
}

async function addCoordinatesToGasStations(stations, userLat, userLng, zip) {
  const limited = stations.slice(0, 12);

  const withCoords = await Promise.all(
    limited.map(async (station) => {
      if (Number.isFinite(station.lat) && Number.isFinite(station.lng)) {
        return station;
      }

      try {
        const query = `${station.name} ${station.address} ${zip}`;
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
            query
          )}`
        );
        const data = await response.json();
        const first = Array.isArray(data) ? data[0] : null;
        const lat = Number(first?.lat);
        const lng = Number(first?.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return station;

        return {
          ...station,
          lat,
          lng,
          distanceMeters: distanceInMeters(userLat, userLng, lat, lng),
        };
      } catch (error) {
        console.error("Gas station geocode error:", error);
        return station;
      }
    })
  );

  return [...withCoords, ...stations.slice(12)];
}

export default function App() {
  const [activeTab, setActiveTab] = useState("drive");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState(
    "Loading Washington, DC traffic camera database..."
  );
  const [lastAlert, setLastAlert] = useState(
    "Waiting for nearby traffic camera alerts."
  );
  const [locationError, setLocationError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraData, setCameraData] = useState([]);
  const [showSpeed, setShowSpeed] = useState(true);
  const [showRedLight, setShowRedLight] = useState(true);
  const [showStopSign, setShowStopSign] = useState(true);
  const [showOther, setShowOther] = useState(true);
  const [alertHistory, setAlertHistory] = useState([]);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [showCurrentStatus, setShowCurrentStatus] = useState(false);
  const [showNearestCameras, setShowNearestCameras] = useState(false);
  const [showGasPrices, setShowGasPrices] = useState(false);
  const [gasStations, setGasStations] = useState([]);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasError, setGasError] = useState("");
  const [gasSort, setGasSort] = useState("cheapest");
  const [gasZip, setGasZip] = useState(DEFAULT_GAS_ZIP);
  const [permissionReady, setPermissionReady] = useState(false);
  const [insideDc, setInsideDc] = useState(true);
  const [showLocationHelp, setShowLocationHelp] = useState(false);
  const [ideaName, setIdeaName] = useState("");
  const [ideaEmail, setIdeaEmail] = useState("");
  const [ideaSuggestion, setIdeaSuggestion] = useState("");
  const [reports, setReports] = useState([]);
  const [reportType, setReportType] = useState("Accident");
  const [reportNote, setReportNote] = useState("");
  const [selectedPlan, setSelectedPlan] = useState(null);

  const watchIdRef = useRef(null);
  const nativeWatchCallbackIdRef = useRef(null);
  const spokenCameraIdsRef = useRef({});
  const insideRadiusIdsRef = useRef({});

  useEffect(() => {
    async function bootstrap() {
      try {
        const prefs = await loadPrefs();
        setVoiceEnabled(toBool(prefs[PREF_KEYS.voiceEnabled], true));
        setShowSpeed(toBool(prefs[PREF_KEYS.showSpeed], true));
        setShowRedLight(toBool(prefs[PREF_KEYS.showRedLight], true));
        setShowStopSign(toBool(prefs[PREF_KEYS.showStopSign], true));
        setShowOther(toBool(prefs[PREF_KEYS.showOther], true));
        setShowAlertHistory(toBool(prefs[PREF_KEYS.showAlertHistory], false));
        setShowCurrentStatus(toBool(prefs[PREF_KEYS.showCurrentStatus], false));
        setShowNearestCameras(toBool(prefs[PREF_KEYS.showNearestCameras], false));
        setShowGasPrices(toBool(prefs[PREF_KEYS.showGasPrices], false));
        setGasZip(prefs[PREF_KEYS.gasZip] || DEFAULT_GAS_ZIP);
      } finally {
        setPrefsLoaded(true);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePref(PREF_KEYS.voiceEnabled, voiceEnabled);
    savePref(PREF_KEYS.showSpeed, showSpeed);
    savePref(PREF_KEYS.showRedLight, showRedLight);
    savePref(PREF_KEYS.showStopSign, showStopSign);
    savePref(PREF_KEYS.showOther, showOther);
    savePref(PREF_KEYS.showAlertHistory, showAlertHistory);
    savePref(PREF_KEYS.showCurrentStatus, showCurrentStatus);
    savePref(PREF_KEYS.showNearestCameras, showNearestCameras);
    savePref(PREF_KEYS.showGasPrices, showGasPrices);
    savePref(PREF_KEYS.gasZip, gasZip);
  }, [
    prefsLoaded,
    voiceEnabled,
    showSpeed,
    showRedLight,
    showStopSign,
    showOther,
    showAlertHistory,
    showCurrentStatus,
    showNearestCameras,
    showGasPrices,
    gasZip,
  ]);

  useEffect(() => {
    async function loadCameras() {
      try {
        setCameraError("");
        const response = await fetch(DC_CAMERA_API);
        const data = await response.json();
        const features = Array.isArray(data.features) ? data.features : [];

        const mapped = features
          .map((item) => {
            const a = item.attributes || {};
            const lat = Number(a.CAMERA_LATITUDE);
            const lng = Number(a.CAMERA_LONGITUDE);
            const typeRaw = String(a.ENFORCEMENT_TYPE || "").toLowerCase();

            let type = "other";
            if (typeRaw.includes("speed")) type = "speed";
            else if (typeRaw.includes("red")) type = "red_light";
            else if (typeRaw.includes("stop")) type = "stop_sign";
            else if (typeRaw.includes("truck")) type = "truck";
            else if (typeRaw.includes("bus")) type = "bus_lane";

            return {
              id:
                a.OBJECTID ||
                a.SITE_CODE ||
                `${a.ENFORCEMENT_SPACE_CODE}-${lat}-${lng}`,
              type,
              typeLabel: a.ENFORCEMENT_TYPE || "Camera",
              name:
                a.ENFORCEMENT_SPACE_CODE ||
                a.LOCATION_DESCRIPTION ||
                "DC Camera",
              description: a.LOCATION_DESCRIPTION || "",
              lat,
              lng,
              speedLimit: a.SPEED_LIMIT,
              activeStatus: a.ACTIVE_STATUS || "",
              cameraStatus: a.CAMERA_STATUS || "",
            };
          })
          .filter(
            (camera) =>
              Number.isFinite(camera.lat) && Number.isFinite(camera.lng)
          )
          .filter((camera) => {
            const statusText =
              `${camera.activeStatus} ${camera.cameraStatus}`.toLowerCase();
            return !(
              statusText.includes("inactive") ||
              statusText.includes("decommission")
            );
          });

        setCameraData(mapped);
        setStatus(
          `Loaded ${mapped.length} Washington, DC traffic cameras. Press start to begin alerts.`
        );
      } catch (error) {
        console.error(error);
        setCameraError(
          "Could not load the Washington, DC traffic camera database."
        );
        setStatus("Could not load traffic camera data.");
      }
    }

    loadCameras();

    return () => {
      if (
        !isNativeApp() &&
        watchIdRef.current !== null &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }

      if (isNativeApp() && nativeWatchCallbackIdRef.current) {
        Geolocation.clearWatch({ id: nativeWatchCallbackIdRef.current }).catch(
          () => {}
        );
      }

      stopSpeaking();
    };
  }, []);

  const cameras = useMemo(() => {
    const filtered = cameraData.filter((camera) => {
      if (camera.type === "speed") return showSpeed;
      if (camera.type === "red_light") return showRedLight;
      if (camera.type === "stop_sign") return showStopSign;
      return showOther;
    });

    if (!position) {
      return filtered.map((camera) => ({
        ...camera,
        distanceMeters: Infinity,
        bearingToCamera: null,
        ahead: true,
      }));
    }

    const userHeading = getHeadingDegrees(position.coords);

    return filtered
      .map((camera) => {
        const distanceMeters = distanceInMeters(
          position.coords.latitude,
          position.coords.longitude,
          camera.lat,
          camera.lng
        );

        const bearingToCamera = bearingBetweenPoints(
          position.coords.latitude,
          position.coords.longitude,
          camera.lat,
          camera.lng
        );

        const ahead = isLikelyAhead(userHeading, bearingToCamera);

        return {
          ...camera,
          distanceMeters,
          bearingToCamera,
          ahead,
        };
      })
      .sort((a, b) => {
        if (a.ahead && !b.ahead) return -1;
        if (!a.ahead && b.ahead) return 1;
        return a.distanceMeters - b.distanceMeters;
      });
  }, [position, cameraData, showSpeed, showRedLight, showStopSign, showOther]);

  const sortedGasStations = useMemo(() => {
    const list = [...gasStations];
    if (gasSort === "closest") {
      return list.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
    return list.sort((a, b) => {
      const aPrice = getBestGasPrice(a);
      const bPrice = getBestGasPrice(b);
      if (aPrice === null && bPrice === null) {
        return a.distanceMeters - b.distanceMeters;
      }
      if (aPrice === null) return 1;
      if (bPrice === null) return -1;
      return aPrice - bPrice;
    });
  }, [gasStations, gasSort]);

  useEffect(() => {
    if (!started || !position || cameras.length === 0) return;

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const withinDc = isInsideDc(lat, lng);
    setInsideDc(withinDc);

    if (!withinDc) {
      setStatus("NoTicket DC currently works only in Washington, DC.");
      return;
    }

    const currentInsideRadius = {};

    cameras.forEach((camera) => {
      if (
        Number.isFinite(camera.distanceMeters) &&
        camera.distanceMeters <= ALERT_DISTANCE_METERS &&
        camera.ahead
      ) {
        currentInsideRadius[camera.id] = true;
      }
    });

    Object.keys(insideRadiusIdsRef.current).forEach((id) => {
      if (!currentInsideRadius[id]) {
        delete insideRadiusIdsRef.current[id];
      }
    });

    const candidates = cameras.filter((camera) => {
      if (!Number.isFinite(camera.distanceMeters)) return false;
      if (camera.distanceMeters > ALERT_DISTANCE_METERS) return false;
      if (!camera.ahead) return false;
      return true;
    });

    if (candidates.length === 0) {
      setStatus(
        "Traffic camera alerts are active. No immediate alerts right now."
      );
      return;
    }

    const selected = candidates[0];
    const alreadyInside = !!insideRadiusIdsRef.current[selected.id];
    const alreadySpoken = !!spokenCameraIdsRef.current[selected.id];

    if (!alreadyInside && !alreadySpoken) {
      const text = getCameraAlertText(selected);

      spokenCameraIdsRef.current[selected.id] = true;
      insideRadiusIdsRef.current[selected.id] = true;

      const newEntry = {
        id: `${selected.id}-${Date.now()}`,
        text,
        time: new Date().toLocaleTimeString(),
      };

      setAlertHistory((prev) => [newEntry, ...prev].slice(0, 20));
      setLastAlert(text);

      if (voiceEnabled) speakText(text);

      fireLocalNotification(
        "NoTicket DC",
        text,
        Number(String(Date.now()).slice(-8))
      );

      setStatus("Traffic camera alert triggered.");
    } else if (!alreadyInside) {
      insideRadiusIdsRef.current[selected.id] = true;
    }
  }, [started, position, cameras, voiceEnabled]);

  async function startCameraAlerts() {
    try {
      setLocationError("");
      setShowLocationHelp(false);
      setStatus(
        "We use your location to warn you about traffic cameras in real time."
      );

      unlockSpeech();

      if (isNativeApp()) {
        const locationGranted = await requestLocationPermission();
        await requestNotificationPermission();

        if (!locationGranted) {
          setLocationError(
            "Location access is required for No Ticket DC alerts. Please enable location in your phone settings, then tap Start Traffic Camera Alerts again."
          );
          setStatus("Location permission denied.");
          setShowLocationHelp(true);
          setStarted(false);
          return;
        }

        setStarted(true);
        spokenCameraIdsRef.current = {};
        insideRadiusIdsRef.current = {};

        if (nativeWatchCallbackIdRef.current) {
          await Geolocation.clearWatch({
            id: nativeWatchCallbackIdRef.current,
          }).catch(() => {});
        }

        nativeWatchCallbackIdRef.current = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 3000,
          },
          (pos, err) => {
            if (err) {
              setLocationError(err.message || "Unable to get your location.");
              setStatus("Unable to get your location.");
              setShowLocationHelp(true);
              return;
            }

            if (pos) {
              setPosition(pos);
              setPermissionReady(true);
              setLocationError("");
              setShowLocationHelp(false);
              setStatus(
                "Traffic camera alerts are active. Tracking location live."
              );
            }
          }
        );

        return;
      }

      if (!navigator.geolocation) {
        setLocationError(
          "Geolocation is not supported on this device/browser."
        );
        setStarted(false);
        setShowLocationHelp(true);
        return;
      }

      setStarted(true);
      spokenCameraIdsRef.current = {};
      insideRadiusIdsRef.current = {};

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setPosition(pos);
          setPermissionReady(true);
          setLocationError("");
          setShowLocationHelp(false);
          setStatus(
            "Traffic camera alerts are active. Tracking location live."
          );
        },
        (error) => {
          let message = "Unable to get your location.";

          if (error.code === 1) {
            message =
              "Location access is required for No Ticket DC alerts. Please enable location in your browser settings, then tap Start Traffic Camera Alerts again.";
          } else if (error.code === 2) {
            message =
              "Location unavailable. Try going outside or checking your GPS.";
          } else if (error.code === 3) {
            message =
              "Location request timed out. Try again outside or wait a few seconds.";
          }

          setLocationError(message);
          setStatus(message);
          setStarted(false);
          setShowLocationHelp(true);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 30000,
        }
      );
    } catch (error) {
      console.error(error);
      setLocationError("Could not start traffic camera alerts.");
      setStatus("Could not start traffic camera alerts.");
      setStarted(false);
      setShowLocationHelp(true);
    }
  }

  async function stopCameraAlerts() {
    if (
      !isNativeApp() &&
      watchIdRef.current !== null &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (isNativeApp() && nativeWatchCallbackIdRef.current) {
      await Geolocation.clearWatch({
        id: nativeWatchCallbackIdRef.current,
      }).catch(() => {});
      nativeWatchCallbackIdRef.current = null;
    }

    await stopSpeaking();

    setStarted(false);
    setStatus("Traffic camera alerts stopped.");
    insideRadiusIdsRef.current = {};
  }

  async function loadGasPricesNearMe(zipOverride) {
    try {
      setShowGasPrices(true);
      setGasLoading(true);
      setGasError("");

      const userLat = position?.coords?.latitude || 38.9072;
      const userLng = position?.coords?.longitude || -77.0369;
      const zip = String(zipOverride || gasZip || DEFAULT_GAS_ZIP).trim();

      if (!/^\d{5}$/.test(zip)) {
        setGasError("Please enter a valid 5-digit ZIP code.");
        setGasLoading(false);
        return;
      }

      const url = `${ZYLA_FUEL_PRICE_URL}?zip=${encodeURIComponent(
        zip
      )}&type=regular`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${ZYLA_FUEL_API_KEY}`,
          Accept: "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok || data?.success === false || data?.error) {
        throw new Error(
          data?.message || data?.error || "Zyla fuel request failed."
        );
      }

      const stationsRaw = normalizeZylaGasData(data, userLat, userLng);
      const stationsWithDetails = await enrichGasStationsWithZylaDetails(
        stationsRaw,
        userLat,
        userLng
      );
      const stations = await addCoordinatesToGasStations(
        stationsWithDetails,
        userLat,
        userLng,
        zip
      );

      if (stations.length === 0) {
        setGasError(
          "Zyla responded, but no gas prices were returned for that ZIP. Try a nearby DC ZIP like 20001, 20002, 20003, 20005, or 20011."
        );
      }

      setGasStations(stations);
    } catch (error) {
      console.error(error);
      setGasError(
        "Could not load real-time fuel prices from Zyla. Check the API key, subscription, endpoint, and ZIP code."
      );
      setGasStations([]);
    } finally {
      setGasLoading(false);
    }
  }

  async function useMyLocationForGas() {
    try {
      setGasLoading(true);
      setGasError("");

      let lat = position?.coords?.latitude;
      let lng = position?.coords?.longitude;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (isNativeApp()) {
          const locationGranted = await requestLocationPermission();
          if (!locationGranted) {
            setGasError("Location access is needed to search fuel prices near you.");
            setGasLoading(false);
            return;
          }
          const current = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 3000,
          });
          setPosition(current);
          lat = current.coords.latitude;
          lng = current.coords.longitude;
        } else if (navigator.geolocation) {
          const current = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              maximumAge: 3000,
              timeout: 30000,
            });
          });
          setPosition(current);
          lat = current.coords.latitude;
          lng = current.coords.longitude;
        }
      }

      const zip =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? await getZipFromLocation(lat, lng)
          : DEFAULT_GAS_ZIP;

      setGasZip(zip);
      await loadGasPricesNearMe(zip);
    } catch (error) {
      console.error(error);
      setGasError("Could not detect your location. Enter your ZIP code instead.");
      setGasLoading(false);
    }
  }

  function submitDriverReport(e) {
    e.preventDefault();

    const lat = position?.coords?.latitude || null;
    const lng = position?.coords?.longitude || null;

    const newReport = {
      id: Date.now(),
      type: reportType,
      note: reportNote || "No extra details added.",
      lat,
      lng,
      time: new Date().toLocaleTimeString(),
    };

    setReports((prev) => [newReport, ...prev].slice(0, 20));
    setReportNote("");

    const alertText = `${reportType} reported ahead. Use caution.`;
    if (voiceEnabled) speakText(alertText);

    fireLocalNotification(
      "NoTicket DC Driver Report",
      alertText,
      Number(String(Date.now()).slice(-8))
    );
  }

  function submitIdeaSuggestion(e) {
    e.preventDefault();
    if (!ideaSuggestion.trim()) return;

    const mailto = buildSuggestionMailto(
      ideaName.trim(),
      ideaEmail.trim(),
      ideaSuggestion.trim()
    );
    window.location.href = mailto;
  }

  const nearestAhead = cameras.find((camera) => camera.ahead) || null;
  const nearest = nearestAhead || cameras[0] || null;
  const camerasAhead = cameras.filter((camera) => camera.ahead).length;
  const userHeading = position
    ? getCardinalDirection(getHeadingDegrees(position.coords))
    : "--";

  const mapCenter = position?.coords
    ? [position.coords.latitude, position.coords.longitude]
    : [38.9072, -77.0369];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d0d",
        color: "white",
        fontFamily: "Arial, sans-serif",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div
          style={{
            textAlign: "center",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <h1 style={{ fontSize: 48, marginBottom: 8 }}>No Ticket DC</h1>
          <p
            style={{
              color: "#cfcfcf",
              fontSize: 20,
              marginTop: 0,
              maxWidth: 720,
              lineHeight: 1.4,
            }}
          >
            Traffic Camera Enforcement Awareness App for Washington DC
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 18,
            justifyContent: "center",
          }}
        >
          {[
            ["drive", "Drive"],
            ["gas", "Gas"],
            ["laws", "DC Traffic Laws"],
            ["report", "Report"],
            ["plans", "Plans"],
            ["savings", "Driver Savings"],
            ["settings", "Settings"],
            ["legal", "Legal"],
            ["ideas", "Ideas"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                background: activeTab === key ? "#dc2626" : "#1f1f1f",
                color: "white",
                border: "1px solid #3b3b3b",
                padding: "12px 18px",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "drive" ? (
          <>
            <SectionCard title="Camera Alerts" accent="#2d2d2d" centered>
              <p style={{ color: "#dedede", lineHeight: 1.6 }}>
                No Ticket DC alerts drivers of speed cameras, stop sign cameras,
                red light cameras, bus lane enforcement and more in Washington DC.
              </p>

              <div
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 14,
                  padding: 12,
                  marginTop: 14,
                  color: "#d5d5d5",
                  lineHeight: 1.6,
                }}
              >
                Background driving alerts require the native app build to add a
                foreground service/background location. Keep the app open until
                that native update is completed.
              </div>

              {showLocationHelp ? (
                <div
                  style={{
                    marginTop: 14,
                    background: "#3b1d00",
                    color: "#ffd08a",
                    padding: 14,
                    borderRadius: 14,
                    lineHeight: 1.6,
                    border: "1px solid #7c2d12",
                  }}
                >
                  <strong>Location access needed.</strong> Turn on location so
                  No Ticket DC can warn you about nearby cameras while you drive.
                  Then tap the red start button again.
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <TrafficActionButton
                  icon="🚦"
                  label={
                    started
                      ? "Stop Traffic Camera Alerts"
                      : "Start Traffic Camera Alerts"
                  }
                  active={started}
                  onClick={() => {
                    unlockSpeech();
                    if (started) {
                      stopCameraAlerts();
                    } else {
                      startCameraAlerts();
                    }
                  }}
                />

                <TrafficActionButton
                  icon="🛑"
                  label="Test Traffic Camera Alerts"
                  active={false}
                  onClick={() => {
                    unlockSpeech();
                    const text = getCameraAlertText({ type: "speed" });
                    setLastAlert(text);
                    if (voiceEnabled) speakText(text);
                    fireLocalNotification(
                      "NoTicket DC",
                      text,
                      Number(String(Date.now()).slice(-8))
                    );
                  }}
                />

                <TrafficActionButton
                  icon="⛔"
                  label={
                    showAlertHistory
                      ? "Hide Traffic Recent Alerts"
                      : "Show Traffic Recent Alerts"
                  }
                  active={showAlertHistory}
                  onClick={() => setShowAlertHistory((prev) => !prev)}
                />

                <TrafficActionButton
                  icon="↔️"
                  label={
                    showCurrentStatus
                      ? "Hide Current Traffic Status"
                      : "Show Current Traffic Status"
                  }
                  active={showCurrentStatus}
                  onClick={() => setShowCurrentStatus((prev) => !prev)}
                />

                <TrafficActionButton
                  icon="➡️"
                  label={
                    showNearestCameras
                      ? "Hide Nearest Traffic Cameras"
                      : "Show Nearest Traffic Cameras"
                  }
                  active={showNearestCameras}
                  onClick={() => setShowNearestCameras((prev) => !prev)}
                />
              </div>

              <div
                style={{
                  marginTop: "18px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  border: "1px solid #333",
                }}
              >
                <MapContainer
                  key={`${mapCenter[0]}-${mapCenter[1]}`}
                  center={mapCenter}
                  zoom={13}
                  scrollWheelZoom={true}
                  style={{ height: "460px", width: "100%" }}
                >
                  <RecenterMap center={mapCenter} zoom={13} />

                  <TileLayer
                    attribution="&copy; OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {position?.coords && (
                    <CircleMarker
                      center={[
                        position.coords.latitude,
                        position.coords.longitude,
                      ]}
                      radius={10}
                      pathOptions={{
                        color: "#22c55e",
                        fillColor: "#22c55e",
                        fillOpacity: 0.9,
                      }}
                    >
                      <Popup>Your current location</Popup>
                    </CircleMarker>
                  )}

                  {cameras.slice(0, 250).map((camera) => (
                    <CircleMarker
                      key={camera.id}
                      center={[camera.lat, camera.lng]}
                      radius={camera.ahead ? 7 : 5}
                      pathOptions={{
                        color: getCameraColor(camera),
                        fillColor: getCameraColor(camera),
                        fillOpacity: camera.ahead ? 0.95 : 0.65,
                      }}
                    >
                      <Popup>
                        <div style={{ minWidth: "220px" }}>
                          <div
                            style={{ fontWeight: "bold", marginBottom: "6px" }}
                          >
                            {camera.typeLabel || "Camera"}
                          </div>
                          <div>{camera.name}</div>
                          <div style={{ marginTop: "4px", color: "#444" }}>
                            {camera.description}
                          </div>
                          <div style={{ marginTop: "8px" }}>
                            Distance: {formatDistance(camera.distanceMeters)}
                          </div>
                          {camera.speedLimit ? (
                            <div style={{ marginTop: "4px" }}>
                              Speed limit: {camera.speedLimit} mph
                            </div>
                          ) : null}
                          <div style={{ marginTop: "4px" }}>
                            {camera.ahead
                              ? "Ahead of driver"
                              : "Other direction"}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                  {showGasPrices &&
                    gasStations
                      .filter(
                        (station) =>
                          Number.isFinite(station.lat) &&
                          Number.isFinite(station.lng)
                      )
                      .map((station) => (
                        <CircleMarker
                          key={station.id}
                          center={[station.lat, station.lng]}
                          radius={7}
                          pathOptions={{
                            color: getGasMarkerColor(station, gasStations),
                            fillColor: getGasMarkerColor(station, gasStations),
                            fillOpacity: 0.95,
                          }}
                        >
                          <Popup>
                            <div style={{ minWidth: "220px" }}>
                              <strong>{station.name}</strong>
                              <div>{station.address}</div>
                              <div style={{ marginTop: 8 }}>
                                Regular: {money(station.regular)}
                              </div>
                              <div>Mid: {money(station.midGrade)}</div>
                              <div>Premium: {money(station.premium)}</div>
                              <div>Diesel: {money(station.diesel)}</div>
                              <div style={{ marginTop: 8 }}>
                                Distance: {formatDistance(station.distanceMeters)}
                              </div>
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))}
                </MapContainer>
              </div>
            </SectionCard>

            {showAlertHistory ? (
              <SectionCard title="Recent Alerts">
                {alertHistory.length === 0 ? (
                  <p style={{ color: "#d5d5d5" }}>No alerts triggered yet.</p>
                ) : (
                  alertHistory.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        background: "#101010",
                        border: "1px solid #333",
                        borderRadius: 12,
                        padding: 14,
                        marginTop: 10,
                      }}
                    >
                      <div style={{ fontWeight: "bold" }}>{entry.time}</div>
                      <div style={{ marginTop: 6, color: "#ddd" }}>
                        {entry.text}
                      </div>
                    </div>
                  ))
                )}
              </SectionCard>
            ) : null}

            {showCurrentStatus ? (
              <SectionCard title="Current Status">
                <p>
                  <strong>Status:</strong> {status}
                </p>
                <p>
                  <strong>Latest alert:</strong> {lastAlert}
                </p>
                <p>
                  <strong>Supported DC cameras loaded:</strong>{" "}
                  {cameraData.length}
                </p>
                <p>
                  <strong>Heading:</strong> {userHeading}
                </p>
                <p>
                  <strong>Inside Washington, DC:</strong>{" "}
                  {insideDc ? "Yes" : "No"}
                </p>
                <p>
                  <strong>Alert distance:</strong> 500 feet
                </p>
                <p>
                  <strong>Permissions ready:</strong>{" "}
                  {permissionReady ? "Yes" : "Not yet"}
                </p>
                <p>
                  <strong>Nearest camera:</strong>{" "}
                  {nearest
                    ? `${nearest.typeLabel || "Camera"} (${formatDistance(
                        nearest.distanceMeters
                      )})`
                    : "--"}
                </p>
                <p>
                  <strong>Cameras ahead:</strong> {camerasAhead}
                </p>

                {locationError ? (
                  <div
                    style={{
                      background: "#3b1d00",
                      color: "#ffd08a",
                      padding: 12,
                      borderRadius: 12,
                      marginTop: 12,
                    }}
                  >
                    {locationError}
                  </div>
                ) : null}

                {cameraError ? (
                  <div
                    style={{
                      background: "#3b1212",
                      color: "#ffb5b5",
                      padding: 12,
                      borderRadius: 12,
                      marginTop: 12,
                    }}
                  >
                    {cameraError}
                  </div>
                ) : null}
              </SectionCard>
            ) : null}

            {showNearestCameras ? (
              <SectionCard title="Nearest Cameras">
                {cameras.slice(0, 20).map((camera) => (
                  <div
                    key={camera.id}
                    style={{
                      background: "#101010",
                      border: "1px solid #333",
                      borderRadius: 12,
                      padding: 14,
                      marginTop: 10,
                    }}
                  >
                    <div style={{ fontWeight: "bold", fontSize: 18 }}>
                      {camera.typeLabel || "Camera"}
                      {camera.ahead ? " • Ahead" : " • Other Direction"}
                    </div>
                    <div style={{ marginTop: 6 }}>{camera.name}</div>
                    <div style={{ color: "#bbb", marginTop: 4 }}>
                      {camera.description}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      Distance: {formatDistance(camera.distanceMeters)}
                    </div>
                    {camera.speedLimit ? (
                      <div style={{ marginTop: 4, color: "#aaa" }}>
                        Speed limit: {camera.speedLimit} mph
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4, color: "#888", fontSize: 14 }}>
                      Status: {camera.activeStatus || "--"} /{" "}
                      {camera.cameraStatus || "--"}
                    </div>
                  </div>
                ))}
              </SectionCard>
            ) : null}
          </>
        ) : null}

        {activeTab === "gas" ? (
          <SectionCard
            title="Real-Time Gas Prices Near Me"
            accent="#16a34a"
            centered
          >
            <p
              style={{
                color: "#d5d5d5",
                lineHeight: 1.7,
                maxWidth: 760,
                margin: "0 auto 16px",
              }}
            >
              Search real-time fuel prices by ZIP code or use your location.
              Green means cheaper, yellow means average, and red means
              expensive.
            </p>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "center",
                marginTop: 14,
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                placeholder="Enter ZIP code"
                value={gasZip}
                onChange={(e) =>
                  setGasZip(e.target.value.replace(/\D/g, "").slice(0, 5))
                }
                style={{
                  width: 160,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              />

              <button
                onClick={() => loadGasPricesNearMe()}
                style={{
                  background: "#16a34a",
                  color: "white",
                  border: "1px solid #22c55e",
                  padding: "12px 16px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Search Gas Prices
              </button>

              <button
                onClick={useMyLocationForGas}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "12px 16px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Use My Location
              </button>

              <button
                onClick={() =>
                  setGasSort(gasSort === "cheapest" ? "closest" : "cheapest")
                }
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "12px 16px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Sort: {gasSort === "cheapest" ? "Cheapest" : "Closest"}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 14,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 16,
                color: "#d5d5d5",
              }}
            >
              <span>🟢 Cheapest</span>
              <span>🟡 Average</span>
              <span>🔴 Expensive</span>
            </div>

            {gasLoading ? <p>Loading real-time gas prices...</p> : null}

            {gasError ? (
              <div
                style={{
                  background: "#3b1212",
                  color: "#ffb5b5",
                  padding: 12,
                  borderRadius: 12,
                  marginTop: 12,
                  textAlign: "center",
                }}
              >
                {gasError}
              </div>
            ) : null}

            {sortedGasStations.length === 0 && !gasLoading ? (
              <p style={{ color: "#bbb" }}>
                No gas prices loaded yet. Enter a ZIP code or tap Use My
                Location.
              </p>
            ) : null}

            {sortedGasStations.map((station) => (
              <div
                key={station.id}
                style={{
                  background: "#101010",
                  border: `1px solid ${getGasMarkerColor(
                    station,
                    gasStations
                  )}`,
                  borderRadius: 12,
                  padding: 14,
                  marginTop: 10,
                  textAlign: "center",
                }}
              >
                <div style={{ fontWeight: "bold", fontSize: 18 }}>
                  {station.name}
                </div>
                <div style={{ color: "#bbb", marginTop: 4 }}>
                  {station.address}
                </div>
                <div style={{ marginTop: 8 }}>
                  Regular: {money(station.regular)}
                </div>
                <div>Mid: {money(station.midGrade)}</div>
                <div>Premium: {money(station.premium)}</div>
                <div>Diesel: {money(station.diesel)}</div>
                <div style={{ marginTop: 8 }}>
                  Distance: {formatDistance(station.distanceMeters)}
                </div>
              </div>
            ))}
          </SectionCard>
        ) : null}

        {activeTab === "laws" ? (
          <SectionCard
            title="DC Traffic Laws & Camera Ticket Traps"
            accent="#facc15"
            centered
          >
            <p style={{ color: "#d5d5d5", lineHeight: 1.7 }}>
              Learn Washington DC traffic laws, camera rules, and common ticket
              traps that can help drivers avoid costly mistakes.
            </p>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              {DC_TRAFFIC_LAWS.map(([title, text]) => (
                <div
                  key={title}
                  style={{
                    background: "#101010",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 16,
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: "bold", fontSize: 18 }}>
                    {title}
                  </div>
                  <div
                    style={{
                      color: "#cfcfcf",
                      lineHeight: 1.6,
                      marginTop: 6,
                    }}
                  >
                    {text}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "report" ? (
          <SectionCard title="Report Road Conditions" accent="#38bdf8" centered>
            <p style={{ color: "#d5d5d5", lineHeight: 1.7 }}>
              Report accidents, police ahead, ice, construction, traffic, or
              road hazards. Reports are local in this web version. To alert all
              users in real time, connect Firebase/Supabase later.
            </p>

            <form onSubmit={submitDriverReport}>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  marginTop: 12,
                }}
              >
                {REPORT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              <textarea
                placeholder="Add details, street name, direction, or notes..."
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                rows={5}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  boxSizing: "border-box",
                  marginTop: 12,
                  resize: "vertical",
                }}
              />

              <button
                type="submit"
                style={{
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  padding: "14px 22px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                  marginTop: 14,
                }}
              >
                Submit Report
              </button>
            </form>

            <div style={{ marginTop: 22 }}>
              <h3>Recent Driver Reports</h3>

              {reports.length === 0 ? (
                <p style={{ color: "#bbb" }}>No reports submitted yet.</p>
              ) : (
                reports.map((report) => (
                  <div
                    key={report.id}
                    style={{
                      background: "#101010",
                      border: "1px solid #333",
                      borderRadius: 12,
                      padding: 14,
                      marginTop: 10,
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontWeight: "bold" }}>
                      {report.type} • {report.time}
                    </div>
                    <div style={{ color: "#cfcfcf", marginTop: 6 }}>
                      {report.note}
                    </div>
                    <div
                      style={{ color: "#888", marginTop: 6, fontSize: 13 }}
                    >
                      Location:{" "}
                      {report.lat && report.lng
                        ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
                        : "Location not available"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "plans" ? (
          <SectionCard
            title="No Ticket DC Subscription Plans"
            accent="#22c55e"
            centered
          >
            <p style={{ color: "#d5d5d5", lineHeight: 1.7 }}>
              Choose the plan that fits how you drive. These buttons are ready
              for Apple App Store and Google Play subscription product IDs.
            </p>

            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              {SUBSCRIPTION_PLANS.map((plan) => (
                <div
                  key={plan.productId}
                  style={{
                    background:
                      selectedPlan === plan.productId ? "#052e16" : "#101010",
                    border:
                      selectedPlan === plan.productId
                        ? "1px solid #22c55e"
                        : "1px solid #333",
                    borderRadius: 14,
                    padding: 18,
                    textAlign: "center",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>{plan.name}</h3>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: "bold",
                      color: "#22c55e",
                    }}
                  >
                    {plan.price}
                  </div>
                  <p style={{ color: "#cfcfcf", lineHeight: 1.6 }}>
                    {plan.detail}
                  </p>
                  <button
                    onClick={() => {
                      setSelectedPlan(plan.productId);
                      alert(
                        `Selected ${plan.name}. Native Apple/Google subscription checkout must be connected in the mobile app build. Product ID: ${plan.productId}`
                      );
                    }}
                    style={{
                      background: "#dc2626",
                      color: "white",
                      border: "none",
                      padding: "12px 18px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                  >
                    Choose Plan
                  </button>
                  <div style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
                    Product ID: {plan.productId}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                background: "#1f1f1f",
                border: "1px solid #444",
                borderRadius: 14,
                padding: 14,
                marginTop: 18,
                color: "#d5d5d5",
                lineHeight: 1.6,
              }}
            >
              Subscription checkout requires native Apple StoreKit and Google
              Play Billing integration in the mobile app build. This page is
              the plan UI and product ID setup.
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "savings" ? (
          <SectionCard
            title="How No Ticket DC Helps Drivers Save Money"
            accent="#22c55e"
            centered
          >
            <p
              style={{
                color: "#d5d5d5",
                lineHeight: 1.7,
                maxWidth: 800,
                margin: "0 auto",
              }}
            >
              No Ticket DC helps drivers avoid costly traffic camera surprises
              and find cheaper fuel while they are already on the road.
            </p>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              {[
                [
                  "🚗",
                  "Uber and Lyft drivers",
                  "Stay aware of red light cameras, speed cameras, stop sign cameras, and nearby fuel prices between rides.",
                ],
                [
                  "🍔",
                  "DoorDash and delivery drivers",
                  "Protect your daily earnings by reducing ticket risk and searching for cheaper gas near your route.",
                ],
                [
                  "🚕",
                  "Taxi drivers and commuters",
                  "Use camera alerts plus fuel price searches to lower daily driving costs in Washington, DC.",
                ],
                [
                  "🚚",
                  "Work vehicles and fleets",
                  "Help company drivers avoid unnecessary camera tickets and reduce fuel expenses across multiple vehicles.",
                ],
              ].map(([icon, title, text]) => (
                <div
                  key={title}
                  style={{
                    background: "#101010",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 16,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 28 }}>{icon}</div>
                  <div
                    style={{ fontWeight: "bold", fontSize: 18, marginTop: 6 }}
                  >
                    {title}
                  </div>
                  <div
                    style={{ color: "#cfcfcf", lineHeight: 1.6, marginTop: 6 }}
                  >
                    {text}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "settings" ? (
          <SectionCard title="Settings">
            <Toggle
              checked={voiceEnabled}
              onChange={setVoiceEnabled}
              label="Voice alerts"
            />
            <Toggle
              checked={showSpeed}
              onChange={setShowSpeed}
              label="Speed cameras"
            />
            <Toggle
              checked={showRedLight}
              onChange={setShowRedLight}
              label="Red light cameras"
            />
            <Toggle
              checked={showStopSign}
              onChange={setShowStopSign}
              label="Stop sign cameras"
            />
            <Toggle
              checked={showOther}
              onChange={setShowOther}
              label="Other enforcement types"
            />
          </SectionCard>
        ) : null}

        {activeTab === "legal" ? (
          <SectionCard title="Legal & Support">
            <div
              style={{
                background: "#101010",
                border: "1px solid #333",
                borderRadius: 12,
                padding: 16,
                lineHeight: 1.7,
              }}
            >
              <strong>Disclaimer:</strong> NoTicket DC is a driver awareness
              tool. Alerts are provided for informational purposes only.
              NoTicket DC does not guarantee avoidance of traffic violations.
              Always follow all traffic laws and posted signs.
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 18,
              }}
            >
              <button onClick={() => openExternal(APP_URLS.privacy)}>
                Privacy Policy
              </button>
              <button onClick={() => openExternal(APP_URLS.terms)}>
                Terms of Service
              </button>
              <button onClick={() => openExternal(APP_URLS.disclaimer)}>
                Disclaimer
              </button>
              <button onClick={() => openExternal(APP_URLS.refund)}>
                Refund Policy
              </button>
              <button onClick={() => openExternal(APP_URLS.contact)}>
                Contact Support
              </button>
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "ideas" ? (
          <SectionCard title="Help Us Make NoTicket DC Better">
            <p style={{ color: "#d5d5d5", lineHeight: 1.7 }}>
              Have an idea for improving the app? Send us your suggestion.
            </p>

            <form onSubmit={submitIdeaSuggestion}>
              <input
                type="text"
                placeholder="Your name"
                value={ideaName}
                onChange={(e) => setIdeaName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  boxSizing: "border-box",
                  marginTop: 12,
                }}
              />

              <input
                type="email"
                placeholder="Your email"
                value={ideaEmail}
                onChange={(e) => setIdeaEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  boxSizing: "border-box",
                  marginTop: 12,
                }}
              />

              <textarea
                placeholder="Your suggestion"
                value={ideaSuggestion}
                onChange={(e) => setIdeaSuggestion(e.target.value)}
                rows={6}
                required
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 12,
                  border: "1px solid #444",
                  background: "#101010",
                  color: "white",
                  boxSizing: "border-box",
                  marginTop: 12,
                  resize: "vertical",
                }}
              />

              <button
                type="submit"
                style={{
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  padding: "14px 22px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                  marginTop: 14,
                }}
              >
                Submit Suggestion
              </button>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
