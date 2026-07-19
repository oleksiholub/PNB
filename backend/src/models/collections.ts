import {
  CollectionReference,
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getFirestoreDb } from "../config/firestore";
import {
  ChatContextDocument,
  CodeArtifactDocument,
  DeadLetterDocument,
  SelectorConfigDocument,
} from "./types";

function converter<T extends DocumentData>() {
  return {
    toFirestore(data: T): DocumentData {
      return data;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}

function typedCollection<T extends DocumentData>(
  db: Firestore,
  path: string
): CollectionReference<T> {
  return db.collection(path).withConverter(converter<T>());
}

export function contextCollection(): CollectionReference<ChatContextDocument> {
  return typedCollection<ChatContextDocument>(getFirestoreDb(), "context");
}

export function codeArtifactsCollection(): CollectionReference<CodeArtifactDocument> {
  return typedCollection<CodeArtifactDocument>(
    getFirestoreDb(),
    "code_artifacts"
  );
}

export function deadLetterCollection(): CollectionReference<DeadLetterDocument> {
  return typedCollection<DeadLetterDocument>(getFirestoreDb(), "dead_letter");
}

export function selectorConfigsCollection(): CollectionReference<SelectorConfigDocument> {
  return typedCollection<SelectorConfigDocument>(
    getFirestoreDb(),
    "selector_configs"
  );
}