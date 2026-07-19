import * as admin from "firebase-admin";

let initialized = false;

export function getFirestoreDb(): admin.firestore.Firestore {
  if (!initialized) {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    initialized = true;
  }
  return admin.firestore();
}