import { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "./MapPicker.css";

// Fix the classic react-leaflet default icon problem under bundlers:
// leaflet tries to resolve the default icon relative to its CSS, which
// doesn't work when images are hashed by Vite. Rebind it to imported URLs.
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Imperatively recenter the map whenever the outside `center` prop changes
// (e.g. user types coords manually, or hits "Use my location").
function Recenter({ center }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (!center) return;
    const key = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    if (last.current === key) return;
    last.current = key;
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

function round6(n) {
  return Number(Number(n).toFixed(6));
}

const DEFAULT_CENTER = { lat: 38.9543, lng: -95.2535 };

function MapPicker({ value, onChange, radiusMeters = 75 }) {
  const center =
    value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
      ? value
      : null;
  // react-leaflet only reads MapContainer props on mount; passing the
  // current center here is safe because later updates are handled by the
  // <Recenter/> effect below.
  const initial = center || DEFAULT_CENTER;

  function commit(next) {
    onChange?.({ lat: round6(next.lat), lng: round6(next.lng) });
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => commit({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="map-picker">
      <div className="map-picker-controls">
        <span className="muted small">
          Click or drag the pin to pick a location.
        </span>
        <button type="button" className="btn map-picker-loc" onClick={useMyLocation}>
          Use my location
        </button>
      </div>

      <div className="map-picker-frame">
        <MapContainer
          center={[initial.lat, initial.lng]}
          zoom={15}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={commit} />
          {center && (
            <>
              <Marker
                position={[center.lat, center.lng]}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    commit({ lat, lng });
                  },
                }}
              />
              <Circle
                center={[center.lat, center.lng]}
                radius={Number(radiusMeters) || 75}
                pathOptions={{
                  color: "#7c9cff",
                  fillColor: "#7c9cff",
                  fillOpacity: 0.15,
                }}
              />
            </>
          )}
          <Recenter center={center} />
        </MapContainer>
      </div>

      {center && (
        <div className="map-picker-coords muted small">
          <span>lat {center.lat.toFixed(6)}</span>
          <span>lng {center.lng.toFixed(6)}</span>
          <span>radius {Number(radiusMeters) || 75} m</span>
        </div>
      )}
    </div>
  );
}

export default MapPicker;
