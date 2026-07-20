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

// Sub-step H.0 FIX: routes/selectorConfig.ts previously bypassed this
// models/collections.ts module entirely and called getFirestoreDb()
// directly to write to TWO different, uncoordinated Firestore paths
// ("selector_configs/{version}" via one raw collection() call AND
// "configs/selectors/versions/current" via a second, structurally
// different nested-subcollection path) for what is supposed to be the
// SAME logical "currently published selector config" concept. This is a
// genuine data-consistency bug (Established confidence, found by
// directly comparing the write paths in the two files): a reader of
// selectorConfigsCollection() would never see what GET
// /selector-config/current actually serves, since that route reads from
// the second, unrelated path. Fixed by adding one canonical accessor for
// the "current" pointer document here, so both the publish (POST) and
// fetch (GET) routes read/write through models/collections.ts exclusively
// - no other module should call getFirestoreDb() directly for selector
// config anymore.
export function currentSelectorConfigDoc() {
  return getFirestoreDb()
    .collection("selector_configs")
    .doc("__current__")
    .withConverter(converter<SelectorConfigDocument>());
}