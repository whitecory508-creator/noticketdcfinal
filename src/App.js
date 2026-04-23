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

function speakText(text) {
  if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.volume = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
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

function cleanLocationText(camera) {
  const text =
    camera.description?.trim() ||
    camera.name?.trim() ||
    "the road ahead";

  return text
    .replace(/\s+/g, " ")
    .replace(/\bNW\b/g, "northwest")
    .replace(/\bNE\b/g, "northeast")
    .replace(/\bSW\b/g, "southwest")
    .replace(/\bSE\b/g, "southeast")
    .replace(/\bN\/B\b/g, "northbound")
    .replace(/\bS\/B\b/g, "southbound")
    .replace(/\bE\/B\b/g, "eastbound")
    .replace(/\bW\/B\b/g, "westbound");
}

function getCameraAlertText(camera) {
  const locationText = cleanLocationText(camera);

  if (camera.type === "speed") {
    return `Speed camera ahead in 500 feet. ${locationText}.`;
  }

  if (camera.type === "red_light") {
    return `Red light camera ahead in 500 feet. ${locationText}.`;
  }

  if (camera.type === "stop_sign") {
    return `Stop sign camera ahead in 500 feet. ${locationText}.`;
  }

  if (camera.type === "bus_lane" || camera.type === "truck") {
    return `Traffic enforcement camera ahead in 500 feet. ${locationText}.`;
  }

  return `Traffic camera ahead in 500 feet. ${locationText}.`;
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

function SectionCard({ title, children, accent = "#333" }) {
  return (
    <div
      style={{
        background: "#171717",
        border: `1px solid ${accent}`,
        borderRadius: 18,
        padding: 20,
        marginTop: 20,
        boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
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

function TrafficActionButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "#dc2626",
        color: "white",
        border: "1px solid #ef4444",
        padding: "14px 18px",
        borderRadius: 14,
        fontSize: 16,
        fontWeight: "bold",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        justifyContent: "flex-start",
        boxShadow: "0 8px 18px rgba(220,38,38,0.25)",
      }}
    >
      <span style={{ fontSize: 24, minWidth: 28, textAlign: "center" }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
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
  const [permissionReady, setPermissionReady] = useState(false);
  const [insideDc, setInsideDc] = useState(true);
  const [showLocationHelp, setShowLocationHelp] = useState(false);
  const [ideaName, setIdeaName] = useState("");
  const [ideaEmail, setIdeaEmail] = useState("");
  const [ideaSuggestion, setIdeaSuggestion] = useState("");

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
        setShowNearestCameras(
          toBool(prefs[PREF_KEYS.showNearestCameras], false)
        );
      } finally {
        setPrefsLoaded(true);
      }
    }

    bootstrap();
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePref(PREF_KEYS.voiceEnabled, voiceEnabled);
  }, [voiceEnabled, prefsLoaded]);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePref(PREF_KEYS.showSpeed, showSpeed);
    savePref(PREF_KEYS.showRedLight, showRedLight);
    savePref(PREF_KEYS.showStopSign, showStopSign);
    savePref(PREF_KEYS.showOther, showOther);
    savePref(PREF_KEYS.showAlertHistory, showAlertHistory);
    savePref(PREF_KEYS.showCurrentStatus, showCurrentStatus);
    savePref(PREF_KEYS.showNearestCameras, showNearestCameras);
  }, [
    showSpeed,
    showRedLight,
    showStopSign,
    showOther,
    showAlertHistory,
    showCurrentStatus,
    showNearestCameras,
    prefsLoaded,
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

      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
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
      setStatus("Traffic camera alerts are active. No immediate alerts right now.");
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

      if (voiceEnabled) {
        speakText(text);
      }

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
      setStatus("We use your location to warn you about traffic cameras in real time.");

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
              setStatus("Traffic camera alerts are active. Tracking location live.");
            }
          }
        );

        return;
      }

      if (!navigator.geolocation) {
        setLocationError("Geolocation is not supported on this device/browser.");
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
          setStatus("Traffic camera alerts are active. Tracking location live.");
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

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setStarted(false);
    setStatus("Traffic camera alerts stopped.");
    insideRadiusIdsRef.current = {};
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ fontSize: 48, marginBottom: 8 }}>No Ticket DC</h1>
            <p style={{ color: "#cfcfcf", fontSize: 20, marginTop: 0 }}>
              Traffic Camera Enforcement Awareness App for Washington DC
            </p>
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}
        >
          {[
            ["drive", "Drive"],
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
            <SectionCard title="Camera Alerts" accent="#2d2d2d">
              <p style={{ color: "#dedede", lineHeight: 1.6 }}>
                No Ticket DC alerts drivers of speed cameras, stop sign cameras,
                red light cameras, bus lane enforcement and more in Washington DC.
              </p>

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

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  marginTop: 16,
                }}
              >
                <TrafficActionButton
                  icon="🚦"
                  label={
                    started
                      ? "Stop Traffic Camera Alerts"
                      : "Start Traffic Camera Alerts"
                  }
                  onClick={started ? stopCameraAlerts : startCameraAlerts}
                />

                <TrafficActionButton
                  icon="🛑"
                  label="Test Traffic Camera Alerts"
                  onClick={() => {
                    const sampleCamera = {
                      type: "red_light",
                      description: "M St W/B @ Wisconsin Ave NW",
                      name: "ATE 0813",
                    };
                    const text = getCameraAlertText(sampleCamera);
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
                  onClick={() => setShowAlertHistory((prev) => !prev)}
                />

                <TrafficActionButton
                  icon="↔️"
                  label={
                    showCurrentStatus
                      ? "Hide Current Traffic Status"
                      : "Show Current Traffic Status"
                  }
                  onClick={() => setShowCurrentStatus((prev) => !prev)}
                />

                <TrafficActionButton
                  icon="➡️"
                  label={
                    showNearestCameras
                      ? "Hide Nearest Traffic Cameras"
                      : "Show Nearest Traffic Cameras"
                  }
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
                      center={[position.coords.latitude, position.coords.longitude]}
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
                          <div style={{ fontWeight: "bold", marginBottom: "6px" }}>
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
                            {camera.ahead ? "Ahead of driver" : "Other direction"}
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
                  <strong>Supported DC cameras loaded:</strong> {cameraData.length}
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

                {!insideDc ? (
                  <div
                    style={{
                      background: "#3b1d00",
                      color: "#ffd08a",
                      padding: 12,
                      borderRadius: 12,
                      marginTop: 12,
                    }}
                  >
                    NoTicket DC currently provides active alert coverage only
                    inside Washington, DC.
                  </div>
                ) : null}

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
                    <div
                      style={{ marginTop: 4, color: "#888", fontSize: 14 }}
                    >
                      Status: {camera.activeStatus || "--"} /{" "}
                      {camera.cameraStatus || "--"}
                    </div>
                  </div>
                ))}
              </SectionCard>
            ) : null}
          </>
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
              <button
                onClick={() => openExternal(APP_URLS.privacy)}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "14px 18px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Privacy Policy
              </button>

              <button
                onClick={() => openExternal(APP_URLS.terms)}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "14px 18px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Terms of Service
              </button>

              <button
                onClick={() => openExternal(APP_URLS.disclaimer)}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "14px 18px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Disclaimer
              </button>

              <button
                onClick={() => openExternal(APP_URLS.refund)}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "14px 18px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Refund Policy
              </button>

              <button
                onClick={() => openExternal(APP_URLS.contact)}
                style={{
                  background: "#1f1f1f",
                  color: "white",
                  border: "1px solid #555",
                  padding: "14px 18px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Contact Support
              </button>
            </div>

            <p style={{ color: "#cfcfcf", marginTop: 18, lineHeight: 1.6 }}>
              Location is used to provide nearby traffic camera alerts while
              using the app in Washington, DC.
            </p>
          </SectionCard>
        ) : null}

        {activeTab === "ideas" ? (
          <SectionCard title="Help Us Make NoTicket DC Better">
            <p style={{ color: "#d5d5d5", lineHeight: 1.7 }}>
              Have an idea for improving the app? Send us your suggestion.
            </p>

            <form onSubmit={submitIdeaSuggestion}>
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Your name
                </label>
                <input
                  type="text"
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
                  }}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Your email
                </label>
                <input
                  type="email"
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
                  }}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Your suggestion
                </label>
                <textarea
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
                    resize: "vertical",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 18,
                }}
              >
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
                  }}
                >
                  Submit Suggestion
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIdeaName("");
                    setIdeaEmail("");
                    setIdeaSuggestion("");
                  }}
                  style={{
                    background: "#1f1f1f",
                    color: "white",
                    border: "1px solid #555",
                    padding: "14px 22px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  Clear Form
                </button>
              </div>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
