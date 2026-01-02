// --- SETUP FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDBNOh34RGhrkJ-3Kj6My_RbGK4P3kIieQ",
    authDomain: "dashboard-alumni-kpi.firebaseapp.com",
    projectId: "dashboard-alumni-kpi",
    storageBucket: "dashboard-alumni-kpi.appspot.com",
    messagingSenderId: "985039765991",
    appId: "1:985039765991:web:b2e397964f4c574aeb3d42"
};

const appId = firebaseConfig.projectId;

// Initialize Firebase & Make Global Variables
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

console.log("Firebase initialized in config.js");