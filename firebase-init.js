/**
 * PERFORMANCE — Firebase Init & Auth Functions
 * Importar como módulo ES em qualquer página do projeto
 *
 * Usage:
 *   import { auth, db, signUpNutri, createPatient, getCurrentRole } from './firebase-init.js';
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyD_HNctj6rWde8LhGZ3diI0Dv836ETSXBE",
  authDomain:        "performance-c506c.firebaseapp.com",
  projectId:         "performance-c506c",
  storageBucket:     "performance-c506c.firebasestorage.app",
  messagingSenderId: "409852210861",
  appId:             "1:409852210861:web:f4d6cb4330b154a495e024",
};

// App principal — sessão do nutricionista/paciente logado
const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// App secundário — exclusivo para criar pacientes sem derrubar sessão do nutri
const secondaryApp  = initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

// ── TIPOS ─────────────────────────────────────────────────────────────────────
/**
 * @typedef {'nutri' | 'patient' | null} UserRole
 */

// ── HELPERS INTERNOS ──────────────────────────────────────────────────────────
async function docExists(path, id){
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? snap.data() : null;
}

// ── AUTH: NUTRICIONISTA ───────────────────────────────────────────────────────
/**
 * Cadastro de Nutricionista
 * Cria conta Firebase Auth + documento em /nutricionistas/{uid}
 *
 * @param {{ name: string, email: string, password: string, crn?: string }} params
 * @returns {Promise<{ uid: string, data: object }>}
 */
export async function signUpNutri({ name, email, password, crn = null }){
  if(!name || name.trim().length < 2) throw new Error("Nome inválido.");
  if(!email)                          throw new Error("E-mail obrigatório.");
  if(!password || password.length < 6) throw new Error("Senha mínima: 6 caracteres.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  const data = {
    uid,
    name:      name.trim(),
    crn:       crn || null,
    email:     email.trim().toLowerCase(),
    createdAt: serverTimestamp(),
    plan:      'free',
    branding:{
      clinicName:   name.trim(),
      primaryColor: '#00D1FF',
      logoUrl:      null,
    },
  };

  await setDoc(doc(db, 'nutricionistas', uid), data);
  return { uid, data };
}

// ── AUTH: PACIENTE (criado pelo Nutri) ────────────────────────────────────────
/**
 * Cria conta de paciente usando app secundário.
 * A sessão do nutricionista no app principal não é afetada.
 *
 * COLEÇÃO: patients (padronizado — não usar 'pacientes')
 *
 * @param {string} nutriId
 * @param {{
 *   name: string, email: string, password: string,
 *   phone?: string, birthDate?: string, sex?: string,
 *   physical?: { weightKg?: number, heightCm?: number, goal?: string },
 *   goals?: {
 *     waterMl?: number, mealsPerDay?: number,
 *     weightKg?: number, weightGoalKg?: number,
 *     macros?: object
 *   }
 * }} patientData
 * @returns {Promise<{ uid: string, appUrl: string }>}
 */
export async function createPatient(nutriId, patientData){
  const {
    name, email, password,
    phone = null, birthDate = null, sex = null,
    physical = {}, goals = {},
  } = patientData;

  if(!name)                             throw new Error("Nome do paciente obrigatório.");
  if(!email)                            throw new Error("E-mail do paciente obrigatório.");
  if(!password || password.length < 6) throw new Error("Senha mínima: 6 caracteres.");

  // Usa app SECUNDÁRIO — sessão do nutricionista fica intacta
  const cred       = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  const patientUid = cred.user.uid;

  // Desconecta paciente do app secundário imediatamente
  await signOut(secondaryAuth);

  // FIX: coleção padronizada como 'patients'
  await setDoc(doc(db, 'patients', patientUid),{
    uid:       patientUid,
    nutriId,
    name:      name.trim(),
    email:     email.trim().toLowerCase(),
    phone,
    birthDate: birthDate || null,
    sex:       sex       || null,
    createdAt: serverTimestamp(),
    status:    'active',
    physical:{
      weightKg: physical.weightKg || null,
      heightCm: physical.heightCm || null,
      goal:     physical.goal     || null,
    },
    goals:{
      waterMl:      goals.waterMl      || 3000,
      mealsPerDay:  goals.mealsPerDay  || 5,
      weightKg:     goals.weightKg     || null,
      weightGoalKg: goals.weightGoalKg || null,
      macros:{
        proteinG: goals.macros?.proteinG || 0,
        carbsG:   goals.macros?.carbsG   || 0,
        fatG:     goals.macros?.fatG     || 0,
      },
    },
    meals:         [],
    supps:         [],
    streak:        0,
    lastActiveDate:null,
    weightHistory: [],
    // Espaço reservado para financeiro (Fase 5 — não implementado ainda)
    billing:{
      plan:        null,
      monthlyFee:  null,
      dueDay:      null,
      status:      null, // 'active' | 'overdue' | 'cancelled'
      lastPayment: null,
    },
  });

  const appUrl = `${location.origin}/index.html?p=${patientUid}`;
  return { uid: patientUid, appUrl };
}

// ── ROLE DETECTION ────────────────────────────────────────────────────────────
/**
 * Retorna a role do usuário logado.
 * @returns {Promise<UserRole>}
 */
export async function getCurrentRole(){
  const user = auth.currentUser;
  if(!user) return null;
  const nutriData = await docExists('nutricionistas', user.uid);
  return nutriData ? 'nutri' : 'patient';
}

/**
 * Listener de auth com redirect automático por role.
 * @param {{ onNutri?: Function, onPatient?: Function, onGuest?: Function }} callbacks
 */
export function authGuard({ onNutri, onPatient, onGuest } = {}){
  onAuthStateChanged(auth, async (user) => {
    if(!user){
      if(onGuest) return onGuest();
      return (window.location.href = 'auth.html');
    }
    const role = await getCurrentRole();
    if(role === 'nutri'){
      if(onNutri) return onNutri(user);
      return (window.location.href = 'admin.html');
    }
    if(role === 'patient'){
      if(onPatient) return onPatient(user);
      return (window.location.href = `index.html?p=${user.uid}`);
    }
  });
}

// ── QUERIES ───────────────────────────────────────────────────────────────────
/**
 * Retorna todos os pacientes de um nutricionista.
 * FIX: usa coleção 'patients' (não 'pacientes')
 * @param {string} nutriId
 */
export async function getPatientsByNutri(nutriId){
  const q    = query(collection(db,'patients'), where('nutriId','==',nutriId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Retorna os dados de um paciente específico.
 * @param {string} patientId
 */
export async function getPatient(patientId){
  const snap = await getDoc(doc(db,'patients',patientId));
  if(!snap.exists()) throw new Error("Paciente não encontrado.");
  return { id: snap.id, ...snap.data() };
}

/**
 * Atualiza as metas de um paciente.
 */
export async function updatePatientGoals(patientId, goals){
  await updateDoc(doc(db,'patients',patientId),{ goals });
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
export async function logout(){
  await signOut(auth);
  window.location.href = 'auth.html';
}
