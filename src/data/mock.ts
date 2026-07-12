/**
 * Seed/mock data. Kept out of the stores so the demo dataset is obvious and
 * deletable once the backend is wired in.
 */

import type { Amenity, Bid, EscrowShipment, FuelPrice, Load } from '../types';

/**
 * The simulated NH-48 style corridor drawn on the map canvas.
 * Normalised 0..1 coordinates — the canvas scales them to its own pixels.
 */
export const ROUTE_PATH: { x: number; y: number }[] = [
  { x: 0.06, y: 0.82 },
  { x: 0.18, y: 0.7 },
  { x: 0.3, y: 0.62 },
  { x: 0.42, y: 0.58 },
  { x: 0.52, y: 0.48 },
  { x: 0.6, y: 0.36 },
  { x: 0.72, y: 0.3 },
  { x: 0.84, y: 0.22 },
  { x: 0.93, y: 0.14 },
];

/** Anchor GPS coordinates matching the two ends of ROUTE_PATH (Delhi → Jaipur). */
export const ROUTE_GPS = {
  start: { latitude: 28.6139, longitude: 77.209 },
  end: { latitude: 26.9124, longitude: 75.7873 },
};

/**
 * Real NH-48 corridor waypoints (Delhi → Gurugram → Behror → Kotputli →
 * Jaipur) — the polyline drawn by the native map. The canvas map uses the
 * normalised ROUTE_PATH above; both describe the same trip.
 */
export const ROUTE_WAYPOINTS: { latitude: number; longitude: number }[] = [
  { latitude: 28.6139, longitude: 77.209 },
  { latitude: 28.4595, longitude: 77.0266 },
  { latitude: 28.2181, longitude: 76.8465 },
  { latitude: 27.9924, longitude: 76.6066 },
  { latitude: 27.8886, longitude: 76.2814 },
  { latitude: 27.7025, longitude: 76.1993 },
  { latitude: 27.4924, longitude: 76.1305 },
  { latitude: 27.1767, longitude: 75.9982 },
  { latitude: 26.9124, longitude: 75.7873 },
];

export const AMENITIES: Amenity[] = [
  {
    id: 'am-1',
    kind: 'dhaba',
    name: 'Sharma Vaishno Dhaba',
    distanceKm: 12,
    rating: 4.4,
    latitude: 28.354,
    longitude: 76.937,
    mapX: 0.24,
    mapY: 0.58,
    servesVeg: true,
    servesNonVeg: false,
    hasDriverParking: true,
  },
  {
    id: 'am-2',
    kind: 'dhaba',
    name: 'Highway King, Behror',
    distanceKm: 38,
    rating: 4.1,
    latitude: 27.889,
    longitude: 76.285,
    mapX: 0.47,
    mapY: 0.44,
    servesVeg: true,
    servesNonVeg: true,
    hasDriverParking: true,
  },
  {
    id: 'am-3',
    kind: 'dhaba',
    name: 'Punjabi Tadka Dhaba',
    distanceKm: 57,
    rating: 3.9,
    latitude: 27.701,
    longitude: 76.198,
    mapX: 0.63,
    mapY: 0.3,
    servesVeg: false,
    servesNonVeg: true,
    hasDriverParking: false,
  },
  {
    id: 'am-4',
    kind: 'mechanic',
    name: 'Tata Authorised Service, Shahjahanpur',
    distanceKm: 24,
    rating: 4.6,
    latitude: 27.993,
    longitude: 76.607,
    mapX: 0.36,
    mapY: 0.64,
    isCertified: true,
  },
  {
    id: 'am-5',
    kind: 'mechanic',
    name: 'Bharat Tyre & Puncture Works',
    distanceKm: 61,
    rating: 4.0,
    latitude: 27.492,
    longitude: 76.13,
    mapX: 0.76,
    mapY: 0.24,
    isCertified: false,
  },
];

function bid(id: string, driverName: string, truckNumber: string, amountInr: number, rating: number): Bid {
  return { id, driverName, truckNumber, amountInr, rating, placedAt: Date.now() - 1000 * 60 * 45 };
}

export const SEED_LOADS: Load[] = [
  {
    id: 'load-1',
    origin: 'Delhi',
    destination: 'Jaipur',
    material: 'Cement bags',
    weightTonnes: 18,
    priceInr: 42000,
    advancePercent: 70,
    status: 'open',
    bids: [
      bid('bid-1', 'Gurpreet Singh', 'PB 10 AB 4321', 41000, 4.7),
      bid('bid-2', 'Ramesh Yadav', 'RJ 14 CD 8890', 43500, 4.2),
    ],
    postedAt: Date.now() - 1000 * 60 * 90,
  },
  {
    id: 'load-2',
    origin: 'Mumbai',
    destination: 'Ahmedabad',
    material: 'FMCG cartons',
    weightTonnes: 9,
    priceInr: 31000,
    advancePercent: 60,
    status: 'open',
    bids: [bid('bid-3', 'Suresh Patil', 'MH 04 EF 2210', 30500, 4.5)],
    postedAt: Date.now() - 1000 * 60 * 30,
  },
  // Backhaul seeds: loads out of Jaipur so the return-load finder has
  // matches for a Delhi→Jaipur trip in demo mode.
  {
    id: 'load-3',
    origin: 'Jaipur',
    destination: 'Delhi',
    material: 'Marble slabs',
    weightTonnes: 16,
    priceInr: 38000,
    advancePercent: 70,
    status: 'open',
    bids: [],
    postedAt: Date.now() - 1000 * 60 * 55,
  },
  {
    id: 'load-4',
    origin: 'Jaipur',
    destination: 'Gurugram',
    material: 'Handicraft cartons',
    weightTonnes: 6,
    priceInr: 22000,
    advancePercent: 60,
    status: 'open',
    bids: [],
    postedAt: Date.now() - 1000 * 60 * 15,
  },
];

/** Demo-mode diesel prices along the NH-48 corridor. */
export const FUEL_PRICES: FuelPrice[] = [
  { city: 'Delhi', state: 'Delhi', dieselInrPerLitre: 87.62, updatedAt: Date.now() },
  { city: 'Gurugram', state: 'Haryana', dieselInrPerLitre: 90.05, updatedAt: Date.now() },
  { city: 'Behror', state: 'Rajasthan', dieselInrPerLitre: 89.32, updatedAt: Date.now() },
  { city: 'Kotputli', state: 'Rajasthan', dieselInrPerLitre: 89.51, updatedAt: Date.now() },
  { city: 'Jaipur', state: 'Rajasthan', dieselInrPerLitre: 89.94, updatedAt: Date.now() },
];

/**
 * One shipment already mid-lifecycle so the escrow dashboard demos the
 * full pipeline on first launch without any clicking.
 */
export const SEED_SHIPMENT: EscrowShipment = {
  id: 'shp-1',
  loadId: 'load-0',
  origin: 'Delhi',
  destination: 'Jaipur',
  driverName: 'Gurpreet Singh',
  truckNumber: 'PB 10 AB 4321',
  totalAmountInr: 42000,
  advancePercent: 70,
  stage: 'CREATED',
  pod: null,
  events: [
    {
      stage: 'CREATED',
      label: 'Load booked — escrow shipment created',
      at: Date.now() - 1000 * 60 * 20,
    },
  ],
};
