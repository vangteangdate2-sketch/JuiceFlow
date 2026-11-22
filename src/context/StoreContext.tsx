import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { getTranslations } from '../i18n/translations';
import type {
  AppLanguage,
  Expense,
  ExpenseCategory,
  ExpenseScope,
  Ingredient,
  PaymentMethod,
  Product,
  Sale,
  SaleItem,
  StockMovement,
  WorkspaceSettings,
} from '../types';
import {
  calculateProductCogs,
  clampNumber,
  generateId,
  generateInviteCode,
  sanitizeString,
  todayIso,
} from '../utils/format';
import { createInitialSettings, createSeedData } from '../utils/seedData';

const LOCAL_STORAGE_KEY = 'juiceflow_store_v1';

interface LocalSnapshot {
  settings: WorkspaceSettings;
  ingredients: Ingredient[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  stockMovements: StockMovement[];
}

function loadLocalSnapshot(): LocalSnapshot {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalSnapshot>;
      if (parsed.settings && Array.isArray(parsed.ingredients) && Array.isArray(parsed.products)) {
        return {
          settings: { ...createInitialSettings(), ...parsed.settings },
          ingredients: parsed.ingredients,
          products: parsed.products,
          sales: Array.isArray(parsed.sales) ? parsed.sales : [],
          expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
          stockMovements: Array.isArray(parsed.stockMovements) ? parsed.stockMovements : [],
        };
      }
    }
  } catch {
    // Fallback to clean seed data
  }
  const seed = createSeedData();
  return {
    settings: createInitialSettings(),
    ...seed,
  };
}

function tsToIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

export interface RecordSaleInput {
  items: { productId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  customerName: string;
  note: string;
  saleDate?: string;
}

export interface RecordPurchaseInput {
  ingredientId: string;
  addedQty: number;
  totalCostKhr: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  note: string;
  purchaseDate?: string;
}

export interface StoreContextValue {
  settings: WorkspaceSettings;
  ingredients: Ingredient[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  stockMovements: StockMovement[];
  user: User | null;
  authReady: boolean;
  cloudSynced: boolean;
  syncing: boolean;
  t: ReturnType<typeof getTranslations>;
  setLanguage: (lang: AppLanguage) => void;
  setActiveOperator: (name: string) => void;
  updateSettings: (patch: Partial<WorkspaceSettings>) => Promise<void>;
  saveProduct: (product: Omit<Product, 'id'> & { id?: string }) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  saveIngredient: (ingredient: Omit<Ingredient, 'id'> & { id?: string }) => Promise<void>;
  deleteIngredient: (ingredientId: string) => Promise<void>;
  recordIngredientPurchase: (input: RecordPurchaseInput) => Promise<void>;
  adjustIngredientStock: (ingredientId: string, deltaQty: number, note: string) => Promise<void>;
  recordSale: (input: RecordSaleInput) => Promise<Sale>;
  voidSale: (saleId: string) => Promise<void>;
  saveExpense: (
    expense: Omit<Expense, 'id' | 'createdAt' | 'recordedBy' | 'linkedIngredientId'> & {
      id?: string;
      linkedIngredientId?: string;
      recordedBy?: string;
    }
  ) => Promise<void>;
  deleteExpense: (expenseId: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  joinWorkspaceByCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  exportJsonBackup: () => string;
  importJsonBackup: (jsonText: string) => { ok: boolean; error?: string };
  resetDemoData: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(() => loadLocalSnapshot(), []);

  const [settings, setSettings] = useState<WorkspaceSettings>(initial.settings);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial.ingredients);
  const [products, setProducts] = useState<Product[]>(initial.products);
  const [sales, setSales] = useState<Sale[]>(initial.sales);
  const [expenses, setExpenses] = useState<Expense[]>(initial.expenses);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(initial.stockMovements);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState<string | null>(null);
  const [memberUids, setMemberUids] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);

  const latestRef = useRef({
    settings,
    ingredients,
    products,
    sales,
    expenses,
    stockMovements,
    memberUids,
  });

  latestRef.current = {
    settings,
    ingredients,
    products,
    sales,
    expenses,
    stockMovements,
    memberUids,
  };

  // Persist offline-first snapshot to localStorage on every state update
  useEffect(() => {
    try {
      const snapshot: LocalSnapshot = {
        settings,
        ingredients,
        products,
        sales,
        expenses,
        stockMovements,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage quota errors
    }
  }, [settings, ingredients, products, sales, expenses, stockMovements]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setCloudWorkspaceId(null);
        setMemberUids([]);
      }
    });
    return () => unsub();
  }, []);

  // Provision or load Cloud Family Workspace when authenticated
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;
    let cancelled = false;

    const bootstrapWorkspace = async () => {
      setSyncing(true);
      const userPath = `users/${user.uid}`;
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;

        if (userSnap.exists()) {
          const data = userSnap.data();
          if (typeof data.workspaceId === 'string' && data.workspaceId.length > 0) {
            setCloudWorkspaceId(data.workspaceId);
            setSyncing(false);
            return;
          }
        }

        // First-time sign-in: create shared family workspace and upload local records atomically
        const wsId = generateId('ws');
        const inviteCode = generateInviteCode();
        const displayName = sanitizeString(user.displayName || user.email?.split('@')[0] || 'Family Member', 100);
        const cur = latestRef.current;
        const familyList = cur.settings.familyMembers.includes(displayName)
          ? cur.settings.familyMembers.slice(0, 10)
          : [displayName, ...cur.settings.familyMembers].slice(0, 10);

        const batch = writeBatch(db);
        const uids = [user.uid];

        batch.set(doc(db, 'workspaces', wsId), {
          name: sanitizeString(cur.settings.name || 'JuiceFlow Family Bar', 100),
          location: sanitizeString(cur.settings.location || 'Phnom Penh, Cambodia', 120),
          inviteCode,
          ownerId: user.uid,
          memberUids: uids,
          currency: 'KHR',
          usdRate: clampNumber(cur.settings.usdRate, 1, 100000),
          language: cur.settings.language === 'vi' ? 'vi' : 'en',
          familyMembers: familyList,
          lowStockDefault: clampNumber(cur.settings.lowStockDefault, 0, 1000000),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'workspaces', wsId, 'members', user.uid), {
          uid: user.uid,
          displayName,
          inviteCode,
          joinedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'workspaceInvites', inviteCode), {
          inviteCode,
          workspaceId: wsId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });

        batch.set(doc(db, 'users', user.uid), {
          uid: user.uid,
          displayName,
          workspaceId: wsId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        if (cancelled) return;

        // Seed existing local records into the newly created cloud workspace
        const seedBatch = writeBatch(db);
        for (const ing of cur.ingredients) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'ingredients', ing.id), {
            workspaceId: wsId,
            memberUids: uids,
            name: sanitizeString(ing.name, 100),
            nameVi: sanitizeString(ing.nameVi, 100),
            unit: ing.unit,
            stockQty: clampNumber(ing.stockQty, -1000000, 100000000),
            reorderLevel: clampNumber(ing.reorderLevel, 0, 100000000),
            unitCostKhr: clampNumber(ing.unitCostKhr, 0, 100000000),
            supplier: sanitizeString(ing.supplier, 100),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const prod of cur.products) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'products', prod.id), {
            workspaceId: wsId,
            memberUids: uids,
            name: sanitizeString(prod.name, 100),
            nameVi: sanitizeString(prod.nameVi, 100),
            category: prod.category,
            priceKhr: clampNumber(prod.priceKhr, 0, 100000000),
            imageUrl: sanitizeString(prod.imageUrl, 300),
            active: Boolean(prod.active),
            recipe: prod.recipe.slice(0, 20),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const sale of cur.sales) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'sales', sale.id), {
            workspaceId: wsId,
            memberUids: uids,
            orderNumber: sanitizeString(sale.orderNumber, 32),
            saleDate: sale.saleDate,
            items: sale.items.slice(0, 30),
            totalKhr: clampNumber(sale.totalKhr, 0, 1000000000),
            cogsKhr: clampNumber(sale.cogsKhr, 0, 1000000000),
            paymentMethod: sale.paymentMethod,
            customerName: sanitizeString(sale.customerName, 80),
            note: sanitizeString(sale.note, 200),
            recordedBy: sanitizeString(sale.recordedBy, 80),
            status: 'completed',
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const exp of cur.expenses) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'expenses', exp.id), {
            workspaceId: wsId,
            memberUids: uids,
            expenseDate: exp.expenseDate,
            title: sanitizeString(exp.title, 120),
            category: exp.category,
            scope: exp.scope,
            amountKhr: clampNumber(exp.amountKhr, 0, 1000000000),
            paymentMethod: exp.paymentMethod,
            vendor: sanitizeString(exp.vendor, 100),
            note: sanitizeString(exp.note, 200),
            linkedIngredientId: sanitizeString(exp.linkedIngredientId, 128),
            recordedBy: sanitizeString(exp.recordedBy, 80),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const mov of cur.stockMovements) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'stockMovements', mov.id), {
            workspaceId: wsId,
            memberUids: uids,
            ingredientId: mov.ingredientId,
            ingredientName: sanitizeString(mov.ingredientName, 100),
            movementType: mov.movementType,
            deltaQty: clampNumber(mov.deltaQty, -10000000, 10000000),
            unit: mov.unit,
            totalCostKhr: clampNumber(mov.totalCostKhr, 0, 1000000000),
            referenceId: sanitizeString(mov.referenceId, 128),
            movementDate: mov.movementDate,
            note: sanitizeString(mov.note, 200),
            recordedBy: sanitizeString(mov.recordedBy, 80),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        }
        await seedBatch.commit();

        if (!cancelled) {
          setCloudWorkspaceId(wsId);
          setMemberUids(uids);
          setSyncing(false);
        }
      } catch (err) {
        if (!cancelled) {
          setSyncing(false);
          handleFirestoreError(err, OperationType.WRITE, userPath);
        }
      }
    };

    bootstrapWorkspace();
    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  // Attach real-time Firestore listeners when authenticated & workspace loaded
  useEffect(() => {
    if (!authReady || !user || !cloudWorkspaceId) return;

    const wsRef = doc(db, 'workspaces', cloudWorkspaceId);
    const unsubWs = onSnapshot(
      wsRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const uids = Array.isArray(d.memberUids) ? (d.memberUids as string[]) : [user.uid];
        setMemberUids(uids);
        setSettings((prev) => ({
          ...prev,
          workspaceId: cloudWorkspaceId,
          inviteCode: String(d.inviteCode || prev.inviteCode),
          name: String(d.name || prev.name),
          location: String(d.location ?? prev.location),
          currency: 'KHR',
          usdRate: Number(d.usdRate) || prev.usdRate,
          language: d.language === 'vi' ? 'vi' : 'en',
          familyMembers:
            Array.isArray(d.familyMembers) && d.familyMembers.length > 0
              ? (d.familyMembers as string[])
              : prev.familyMembers,
          lowStockDefault: Number(d.lowStockDefault ?? prev.lowStockDefault),
        }));
      },
      (err) => handleFirestoreError(err, OperationType.GET, `workspaces/${cloudWorkspaceId}`)
    );

    const prodPath = `workspaces/${cloudWorkspaceId}/products`;
    const unsubProducts = onSnapshot(
      query(collection(db, prodPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Product[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            name: String(d.name || ''),
            nameVi: String(d.nameVi || ''),
            category: d.category,
            priceKhr: Number(d.priceKhr) || 0,
            imageUrl: String(d.imageUrl || ''),
            active: Boolean(d.active),
            recipe: Array.isArray(d.recipe) ? d.recipe : [],
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          };
        });
        setProducts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, prodPath)
    );

    const ingPath = `workspaces/${cloudWorkspaceId}/ingredients`;
    const unsubIngredients = onSnapshot(
      query(collection(db, ingPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Ingredient[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            name: String(d.name || ''),
            nameVi: String(d.nameVi || ''),
            unit: d.unit,
            stockQty: Number(d.stockQty) || 0,
            reorderLevel: Number(d.reorderLevel) || 0,
            unitCostKhr: Number(d.unitCostKhr) || 0,
            supplier: String(d.supplier || ''),
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          };
        });
        setIngredients(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, ingPath)
    );

    const salesPath = `workspaces/${cloudWorkspaceId}/sales`;
    const unsubSales = onSnapshot(
      query(collection(db, salesPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Sale[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              orderNumber: String(d.orderNumber || ''),
              saleDate: String(d.saleDate || todayIso()),
              items: Array.isArray(d.items) ? (d.items as SaleItem[]) : [],
              totalKhr: Number(d.totalKhr) || 0,
              cogsKhr: Number(d.cogsKhr) || 0,
              paymentMethod: d.paymentMethod,
              customerName: String(d.customerName || ''),
              note: String(d.note || ''),
              recordedBy: String(d.recordedBy || ''),
              status: (d.status === 'voided' ? 'voided' : 'completed') as 'completed' | 'voided',
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSales(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, salesPath)
    );

    const expPath = `workspaces/${cloudWorkspaceId}/expenses`;
    const unsubExpenses = onSnapshot(
      query(collection(db, expPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Expense[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              expenseDate: String(d.expenseDate || todayIso()),
              title: String(d.title || ''),
              category: d.category as ExpenseCategory,
              scope: (d.scope === 'household' ? 'household' : 'business') as ExpenseScope,
              amountKhr: Number(d.amountKhr) || 0,
              paymentMethod: d.paymentMethod as PaymentMethod,
              vendor: String(d.vendor || ''),
              note: String(d.note || ''),
              linkedIngredientId: String(d.linkedIngredientId || ''),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt));
        setExpenses(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, expPath)
    );

    const movPath = `workspaces/${cloudWorkspaceId}/stockMovements`;
    const unsubMovements = onSnapshot(
      query(collection(db, movPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: StockMovement[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              ingredientId: String(d.ingredientId || ''),
              ingredientName: String(d.ingredientName || ''),
              movementType: d.movementType,
              deltaQty: Number(d.deltaQty) || 0,
              unit: d.unit,
              totalCostKhr: Number(d.totalCostKhr) || 0,
              referenceId: String(d.referenceId || ''),
              movementDate: String(d.movementDate || todayIso()),
              note: String(d.note || ''),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setStockMovements(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, movPath)
    );

    return () => {
      unsubWs();
      unsubProducts();
      unsubIngredients();
      unsubSales();
      unsubExpenses();
      unsubMovements();
    };
  }, [authReady, user, cloudWorkspaceId]);

  // Propagate memberUids to existing subcollection docs whenever a new family member joins
  useEffect(() => {
    if (!user || !cloudWorkspaceId || memberUids.length <= 1) return;
    const propagateMembers = async () => {
      try {
        const cur = latestRef.current;
        const batch = writeBatch(db);
        let ops = 0;
        for (const p of cur.products) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', p.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const ing of cur.ingredients) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ing.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const s of cur.sales) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'sales', s.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const e of cur.expenses) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', e.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const m of cur.stockMovements) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', m.id), {
            memberUids,
          });
          ops++;
        }
        if (ops > 0 && ops < 450) {
          await batch.commit();
        }
      } catch {
        // Non-fatal background sync
      }
    };
    propagateMembers();
  }, [memberUids.length, user, cloudWorkspaceId]);

  const activeMemberUids = useCallback((): string[] => {
    if (!user) return [];
    return memberUids.includes(user.uid) ? memberUids : [user.uid, ...memberUids].slice(0, 10);
  }, [user, memberUids]);

  const setLanguage = useCallback(
    (lang: AppLanguage) => {
      setSettings((prev) => ({ ...prev, language: lang }));
      if (user && cloudWorkspaceId) {
        updateDoc(doc(db, 'workspaces', cloudWorkspaceId), {
          language: lang,
          updatedAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `workspaces/${cloudWorkspaceId}`));
      }
    },
    [user, cloudWorkspaceId]
  );

  const setActiveOperator = useCallback((name: string) => {
    setSettings((prev) => ({ ...prev, activeOperator: name }));
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<WorkspaceSettings>) => {
      const next: WorkspaceSettings = {
        ...latestRef.current.settings,
        ...patch,
      };
      setSettings(next);
      if (user && cloudWorkspaceId) {
        const wsPath = `workspaces/${cloudWorkspaceId}`;
        try {
          await updateDoc(doc(db, 'workspaces', cloudWorkspaceId), {
            name: sanitizeString(next.name || 'JuiceFlow', 100),
            location: sanitizeString(next.location, 120),
            usdRate: clampNumber(next.usdRate, 1, 100000),
            language: next.language === 'vi' ? 'vi' : 'en',
            familyMembers: next.familyMembers.slice(0, 10),
            lowStockDefault: clampNumber(next.lowStockDefault, 0, 1000000),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, wsPath);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const saveProduct = useCallback(
    async (input: Omit<Product, 'id'> & { id?: string }) => {
      const isEdit = Boolean(input.id);
      const id = input.id || generateId('prod');
      const clean: Product = {
        id,
        name: sanitizeString(input.name, 100),
        nameVi: sanitizeString(input.nameVi || input.name, 100),
        category: input.category,
        priceKhr: clampNumber(input.priceKhr, 0, 100000000),
        imageUrl: sanitizeString(input.imageUrl, 300),
        active: Boolean(input.active),
        recipe: input.recipe
          .filter((r) => r.ingredientId && r.quantity > 0)
          .slice(0, 20)
          .map((r) => ({ ingredientId: r.ingredientId, quantity: clampNumber(r.quantity, 0.001, 1000000) })),
        updatedAt: new Date().toISOString(),
      };

      setProducts((prev) => (isEdit ? prev.map((p) => (p.id === id ? clean : p)) : [clean, ...prev]));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/products/${id}`;
        try {
          if (isEdit) {
            await updateDoc(doc(db, 'workspaces', cloudWorkspaceId, 'products', id), {
              name: clean.name,
              nameVi: clean.nameVi,
              category: clean.category,
              priceKhr: clean.priceKhr,
              imageUrl: clean.imageUrl,
              active: clean.active,
              recipe: clean.recipe,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, 'workspaces', cloudWorkspaceId, 'products', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: activeMemberUids(),
              name: clean.name,
              nameVi: clean.nameVi,
              category: clean.category,
              priceKhr: clean.priceKhr,
              imageUrl: clean.imageUrl,
              active: clean.active,
              recipe: clean.recipe,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteProduct = useCallback(
    async (productId: string) => {
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/products/${productId}`;
        try {
          await deleteDoc(doc(db, 'workspaces', cloudWorkspaceId, 'products', productId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const saveIngredient = useCallback(
    async (input: Omit<Ingredient, 'id'> & { id?: string }) => {
      const isEdit = Boolean(input.id);
      const id = input.id || generateId('ing');
      const clean: Ingredient = {
        id,
        name: sanitizeString(input.name, 100),
        nameVi: sanitizeString(input.nameVi || input.name, 100),
        unit: input.unit,
        stockQty: clampNumber(input.stockQty, -1000000, 100000000),
        reorderLevel: clampNumber(input.reorderLevel, 0, 100000000),
        unitCostKhr: clampNumber(input.unitCostKhr, 0, 100000000),
        supplier: sanitizeString(input.supplier, 100),
        updatedAt: new Date().toISOString(),
      };

      setIngredients((prev) => (isEdit ? prev.map((i) => (i.id === id ? clean : i)) : [clean, ...prev]));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/ingredients/${id}`;
        try {
          if (isEdit) {
            await updateDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', id), {
              name: clean.name,
              nameVi: clean.nameVi,
              unit: clean.unit,
              stockQty: clean.stockQty,
              reorderLevel: clean.reorderLevel,
              unitCostKhr: clean.unitCostKhr,
              supplier: clean.supplier,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: activeMemberUids(),
              name: clean.name,
              nameVi: clean.nameVi,
              unit: clean.unit,
              stockQty: clean.stockQty,
              reorderLevel: clean.reorderLevel,
              unitCostKhr: clean.unitCostKhr,
              supplier: clean.supplier,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteIngredient = useCallback(
    async (ingredientId: string) => {
      setIngredients((prev) => prev.filter((i) => i.id !== ingredientId));
      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/ingredients/${ingredientId}`;
        try {
          await deleteDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingredientId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const recordIngredientPurchase = useCallback(
    async (input: RecordPurchaseInput) => {
      const cur = latestRef.current;
      const ing = cur.ingredients.find((i) => i.id === input.ingredientId);
      if (!ing) return;

      const addedQty = clampNumber(input.addedQty, 0.001, 10000000);
      const totalCostKhr = clampNumber(input.totalCostKhr, 0, 1000000000);
      const purchaseDate = input.purchaseDate || todayIso();
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const existingVal = Math.max(0, ing.stockQty) * ing.unitCostKhr;
      const newStockQty = Number((ing.stockQty + addedQty).toFixed(3));
      const newUnitCostKhr =
        newStockQty > 0 ? Math.round((existingVal + totalCostKhr) / newStockQty) : ing.unitCostKhr;

      const expId = generateId('exp');
      const movId = generateId('mov');
      const nowIso = new Date().toISOString();

      const newExpense: Expense = {
        id: expId,
        expenseDate: purchaseDate,
        title: sanitizeString(`Purchase: ${ing.name} (${addedQty} ${ing.unit})`, 120),
        category: 'ingredients',
        scope: 'business',
        amountKhr: totalCostKhr,
        paymentMethod: input.paymentMethod,
        vendor: sanitizeString(input.vendor || ing.supplier, 100),
        note: sanitizeString(input.note, 200),
        linkedIngredientId: ing.id,
        recordedBy: operator,
        createdAt: nowIso,
      };

      const newMovement: StockMovement = {
        id: movId,
        ingredientId: ing.id,
        ingredientName: sanitizeString(ing.name, 100),
        movementType: 'purchase',
        deltaQty: addedQty,
        unit: ing.unit,
        totalCostKhr,
        referenceId: expId,
        movementDate: purchaseDate,
        note: sanitizeString(input.note || `Restock from ${input.vendor || ing.supplier || 'market'}`, 200),
        recordedBy: operator,
        createdAt: nowIso,
      };

      setIngredients((prev) =>
        prev.map((i) =>
          i.id === ing.id ? { ...i, stockQty: newStockQty, unitCostKhr: newUnitCostKhr } : i
        )
      );
      setExpenses((prev) => [newExpense, ...prev]);
      setStockMovements((prev) => [newMovement, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const batchPath = `workspaces/${cloudWorkspaceId}/ingredients/${ing.id}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ing.id), {
            stockQty: newStockQty,
            unitCostKhr: newUnitCostKhr,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', expId), {
            workspaceId: cloudWorkspaceId,
            memberUids: uids,
            expenseDate: newExpense.expenseDate,
            title: newExpense.title,
            category: newExpense.category,
            scope: newExpense.scope,
            amountKhr: newExpense.amountKhr,
            paymentMethod: newExpense.paymentMethod,
            vendor: newExpense.vendor,
            note: newExpense.note,
            linkedIngredientId: newExpense.linkedIngredientId,
            recordedBy: newExpense.recordedBy,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', movId), {
            workspaceId: cloudWorkspaceId,
            memberUids: uids,
            ingredientId: newMovement.ingredientId,
            ingredientName: newMovement.ingredientName,
            movementType: newMovement.movementType,
            deltaQty: newMovement.deltaQty,
            unit: newMovement.unit,
            totalCostKhr: newMovement.totalCostKhr,
            referenceId: newMovement.referenceId,
            movementDate: newMovement.movementDate,
            note: newMovement.note,
            recordedBy: newMovement.recordedBy,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, batchPath);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const adjustIngredientStock = useCallback(
    async (ingredientId: string, deltaQty: number, note: string) => {
      const cur = latestRef.current;
      const ing = cur.ingredients.find((i) => i.id === ingredientId);
      if (!ing || !Number.isFinite(deltaQty) || deltaQty === 0) return;

      const newStockQty = Number((ing.stockQty + deltaQty).toFixed(3));
      const movId = generateId('mov');
      const nowIso = new Date().toISOString();
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const movement: StockMovement = {
        id: movId,
        ingredientId: ing.id,
        ingredientName: sanitizeString(ing.name, 100),
        movementType: 'adjustment',
        deltaQty,
        unit: ing.unit,
        totalCostKhr: Math.round(Math.abs(deltaQty) * ing.unitCostKhr),
        referenceId: '',
        movementDate: todayIso(),
        note: sanitizeString(note || 'Manual stock adjustment', 200),
        recordedBy: operator,
        createdAt: nowIso,
      };

      setIngredients((prev) =>
        prev.map((i) => (i.id === ing.id ? { ...i, stockQty: newStockQty } : i))
      );
      setStockMovements((prev) => [movement, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const batchPath = `workspaces/${cloudWorkspaceId}/ingredients/${ing.id}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ing.id), {
            stockQty: newStockQty,
            unitCostKhr: ing.unitCostKhr,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', movId), {
            workspaceId: cloudWorkspaceId,
            memberUids: uids,
            ingredientId: movement.ingredientId,
            ingredientName: movement.ingredientName,
            movementType: movement.movementType,
            deltaQty: movement.deltaQty,
            unit: movement.unit,
            totalCostKhr: movement.totalCostKhr,
            referenceId: movement.referenceId,
            movementDate: movement.movementDate,
            note: movement.note,
            recordedBy: movement.recordedBy,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, batchPath);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const recordSale = useCallback(
    async (input: RecordSaleInput): Promise<Sale> => {
      const cur = latestRef.current;
      const prodMap = new Map(cur.products.map((p) => [p.id, p]));
      const ingMap = new Map(cur.ingredients.map((i) => [i.id, i]));

      const saleItems: SaleItem[] = [];
      const ingredientDeductions = new Map<string, number>();

      for (const reqItem of input.items) {
        const product = prodMap.get(reqItem.productId);
        if (!product || reqItem.quantity <= 0) continue;
        const qty = Math.round(reqItem.quantity);
        const unitCogsKhr = Math.round(calculateProductCogs(product, cur.ingredients));
        saleItems.push({
          productId: product.id,
          productName: sanitizeString(product.name, 100),
          productNameVi: sanitizeString(product.nameVi || product.name, 100),
          quantity: qty,
          unitPriceKhr: product.priceKhr,
          unitCogsKhr,
          lineTotalKhr: product.priceKhr * qty,
        });

        for (const recipeRow of product.recipe) {
          const prevDeduct = ingredientDeductions.get(recipeRow.ingredientId) || 0;
          ingredientDeductions.set(recipeRow.ingredientId, prevDeduct + recipeRow.quantity * qty);
        }
      }

      const saleId = generateId('sale');
      const orderNum = `JF-${String(1043 + cur.sales.length).padStart(4, '0')}`;
      const saleDate = input.saleDate || todayIso();
      const nowIso = new Date().toISOString();
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const totalKhr = saleItems.reduce((s, item) => s + item.lineTotalKhr, 0);
      const cogsKhr = saleItems.reduce((s, item) => s + item.unitCogsKhr * item.quantity, 0);

      const newSale: Sale = {
        id: saleId,
        orderNumber: orderNum,
        saleDate,
        items: saleItems.slice(0, 30),
        totalKhr,
        cogsKhr,
        paymentMethod: input.paymentMethod,
        customerName: sanitizeString(input.customerName, 80),
        note: sanitizeString(input.note, 200),
        recordedBy: operator,
        status: 'completed',
        createdAt: nowIso,
      };

      const newMovements: StockMovement[] = [];
      const updatedIngredients = cur.ingredients.map((ing) => {
        const usedQty = ingredientDeductions.get(ing.id);
        if (!usedQty) return ing;
        const roundedUsed = Number(usedQty.toFixed(3));
        newMovements.push({
          id: generateId('mov'),
          ingredientId: ing.id,
          ingredientName: sanitizeString(ing.name, 100),
          movementType: 'sale_consumption',
          deltaQty: -roundedUsed,
          unit: ing.unit,
          totalCostKhr: Math.round(roundedUsed * ing.unitCostKhr),
          referenceId: saleId,
          movementDate: saleDate,
          note: sanitizeString(`Auto deduction for order ${orderNum}`, 200),
          recordedBy: operator,
          createdAt: nowIso,
        });
        return {
          ...ing,
          stockQty: Number((ing.stockQty - roundedUsed).toFixed(3)),
        };
      });

      setSales((prev) => [newSale, ...prev]);
      setIngredients(updatedIngredients);
      if (newMovements.length > 0) {
        setStockMovements((prev) => [...newMovements, ...prev]);
      }

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const path = `workspaces/${cloudWorkspaceId}/sales/${saleId}`;
        try {
          const batch = writeBatch(db);
          batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'sales', saleId), {
            workspaceId: cloudWorkspaceId,
            memberUids: uids,
            orderNumber: newSale.orderNumber,
            saleDate: newSale.saleDate,
            items: newSale.items,
            totalKhr: newSale.totalKhr,
            cogsKhr: newSale.cogsKhr,
            paymentMethod: newSale.paymentMethod,
            customerName: newSale.customerName,
            note: newSale.note,
            recordedBy: newSale.recordedBy,
            status: 'completed',
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          for (const [ingId] of ingredientDeductions.entries()) {
            const updatedIng = updatedIngredients.find((i) => i.id === ingId);
            if (!updatedIng || !ingMap.has(ingId)) continue;
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingId), {
              stockQty: updatedIng.stockQty,
              unitCostKhr: updatedIng.unitCostKhr,
              updatedAt: serverTimestamp(),
            });
          }

          for (const mov of newMovements) {
            batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id), {
              workspaceId: cloudWorkspaceId,
              memberUids: uids,
              ingredientId: mov.ingredientId,
              ingredientName: mov.ingredientName,
              movementType: mov.movementType,
              deltaQty: mov.deltaQty,
              unit: mov.unit,
              totalCostKhr: mov.totalCostKhr,
              referenceId: mov.referenceId,
              movementDate: mov.movementDate,
              note: mov.note,
              recordedBy: mov.recordedBy,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      return newSale;
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const voidSale = useCallback(
    async (saleId: string) => {
      const cur = latestRef.current;
      const targetSale = cur.sales.find((s) => s.id === saleId);
      if (!targetSale || targetSale.status === 'voided') return;

      const prodMap = new Map(cur.products.map((p) => [p.id, p]));
      const restoreMap = new Map<string, number>();

      for (const item of targetSale.items) {
        const prod = prodMap.get(item.productId);
        if (!prod) continue;
        for (const r of prod.recipe) {
          restoreMap.set(r.ingredientId, (restoreMap.get(r.ingredientId) || 0) + r.quantity * item.quantity);
        }
      }

      const nowIso = new Date().toISOString();
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);
      const restoreMovements: StockMovement[] = [];

      const updatedIngredients = cur.ingredients.map((ing) => {
        const qty = restoreMap.get(ing.id);
        if (!qty) return ing;
        const rounded = Number(qty.toFixed(3));
        restoreMovements.push({
          id: generateId('mov'),
          ingredientId: ing.id,
          ingredientName: sanitizeString(ing.name, 100),
          movementType: 'void_restore',
          deltaQty: rounded,
          unit: ing.unit,
          totalCostKhr: Math.round(rounded * ing.unitCostKhr),
          referenceId: saleId,
          movementDate: todayIso(),
          note: sanitizeString(`Restored from voided order ${targetSale.orderNumber}`, 200),
          recordedBy: operator,
          createdAt: nowIso,
        });
        return {
          ...ing,
          stockQty: Number((ing.stockQty + rounded).toFixed(3)),
        };
      });

      setSales((prev) => prev.map((s) => (s.id === saleId ? { ...s, status: 'voided' } : s)));
      setIngredients(updatedIngredients);
      if (restoreMovements.length > 0) {
        setStockMovements((prev) => [...restoreMovements, ...prev]);
      }

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const path = `workspaces/${cloudWorkspaceId}/sales/${saleId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'sales', saleId), {
            status: 'voided',
            updatedAt: serverTimestamp(),
          });
          for (const [ingId] of restoreMap.entries()) {
            const updatedIng = updatedIngredients.find((i) => i.id === ingId);
            if (!updatedIng) continue;
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingId), {
              stockQty: updatedIng.stockQty,
              unitCostKhr: updatedIng.unitCostKhr,
              updatedAt: serverTimestamp(),
            });
          }
          for (const mov of restoreMovements) {
            batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id), {
              workspaceId: cloudWorkspaceId,
              memberUids: uids,
              ingredientId: mov.ingredientId,
              ingredientName: mov.ingredientName,
              movementType: mov.movementType,
              deltaQty: mov.deltaQty,
              unit: mov.unit,
              totalCostKhr: mov.totalCostKhr,
              referenceId: mov.referenceId,
              movementDate: mov.movementDate,
              note: mov.note,
              recordedBy: mov.recordedBy,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const saveExpense = useCallback(
    async (
      input: Omit<Expense, 'id' | 'createdAt' | 'recordedBy' | 'linkedIngredientId'> & {
        id?: string;
        linkedIngredientId?: string;
        recordedBy?: string;
      }
    ) => {
      const isEdit = Boolean(input.id);
      const id = input.id || generateId('exp');
      const operator = sanitizeString(
        input.recordedBy || latestRef.current.settings.activeOperator || 'Family',
        80
      );
      const clean: Expense = {
        id,
        expenseDate: input.expenseDate || todayIso(),
        title: sanitizeString(input.title, 120),
        category: input.category,
        scope: input.scope,
        amountKhr: clampNumber(input.amountKhr, 0, 1000000000),
        paymentMethod: input.paymentMethod,
        vendor: sanitizeString(input.vendor, 100),
        note: sanitizeString(input.note, 200),
        linkedIngredientId: sanitizeString(input.linkedIngredientId || '', 128),
        recordedBy: operator,
        createdAt: new Date().toISOString(),
      };

      setExpenses((prev) => (isEdit ? prev.map((e) => (e.id === id ? { ...e, ...clean } : e)) : [clean, ...prev]));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/expenses/${id}`;
        try {
          if (isEdit) {
            await updateDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', id), {
              expenseDate: clean.expenseDate,
              title: clean.title,
              category: clean.category,
              scope: clean.scope,
              amountKhr: clean.amountKhr,
              paymentMethod: clean.paymentMethod,
              vendor: clean.vendor,
              note: clean.note,
              recordedBy: clean.recordedBy,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: activeMemberUids(),
              expenseDate: clean.expenseDate,
              title: clean.title,
              category: clean.category,
              scope: clean.scope,
              amountKhr: clean.amountKhr,
              paymentMethod: clean.paymentMethod,
              vendor: clean.vendor,
              note: clean.note,
              linkedIngredientId: clean.linkedIngredientId,
              recordedBy: clean.recordedBy,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteExpense = useCallback(
    async (expenseId: string) => {
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/expenses/${expenseId}`;
        try {
          await deleteDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', expenseId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOutGoogle = useCallback(async () => {
    await signOut(auth);
  }, []);

  const joinWorkspaceByCode = useCallback(
    async (rawCode: string): Promise<{ ok: boolean; error?: string }> => {
      if (!user) return { ok: false, error: 'Sign in with Google first.' };
      const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 6 || code.length > 16) {
        return { ok: false, error: 'Invalid code format.' };
      }

      try {
        const inviteSnap = await getDoc(doc(db, 'workspaceInvites', code));
        if (!inviteSnap.exists()) {
          return { ok: false, error: 'Workspace code not found.' };
        }
        const targetWsId = String(inviteSnap.data().workspaceId || '');
        if (!targetWsId) return { ok: false, error: 'Invalid invite record.' };

        const displayName = sanitizeString(user.displayName || user.email?.split('@')[0] || 'Family Member', 100);

        // Step 1: Join workspace members subcollection (Master Gate)
        await setDoc(doc(db, 'workspaces', targetWsId, 'members', user.uid), {
          uid: user.uid,
          displayName,
          inviteCode: code,
          joinedAt: serverTimestamp(),
        });

        // Step 2: Read workspace and append UID to memberUids & familyMembers
        const wsSnap = await getDoc(doc(db, 'workspaces', targetWsId));
        if (wsSnap.exists()) {
          const wsData = wsSnap.data();
          const currentUids: string[] = Array.isArray(wsData.memberUids) ? wsData.memberUids : [];
          const nextUids = currentUids.includes(user.uid)
            ? currentUids
            : [...currentUids, user.uid].slice(0, 10);
          const currentFamily: string[] = Array.isArray(wsData.familyMembers) ? wsData.familyMembers : [];
          const nextFamily = currentFamily.includes(displayName)
            ? currentFamily
            : [...currentFamily, displayName].slice(0, 10);

          await updateDoc(doc(db, 'workspaces', targetWsId), {
            memberUids: nextUids,
            familyMembers: nextFamily,
            updatedAt: serverTimestamp(),
          });
        }

        // Step 3: Point user profile to the joined family workspace
        await updateDoc(doc(db, 'users', user.uid), {
          displayName,
          workspaceId: targetWsId,
          updatedAt: serverTimestamp(),
        });

        setCloudWorkspaceId(targetWsId);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Unable to join workspace. Check code and network connection.' };
      }
    },
    [user]
  );

  const exportJsonBackup = useCallback((): string => {
    const payload = {
      app: 'JuiceFlow',
      exportedAt: new Date().toISOString(),
      settings: latestRef.current.settings,
      ingredients: latestRef.current.ingredients,
      products: latestRef.current.products,
      sales: latestRef.current.sales,
      expenses: latestRef.current.expenses,
      stockMovements: latestRef.current.stockMovements,
    };
    return JSON.stringify(payload, null, 2);
  }, []);

  const importJsonBackup = useCallback((jsonText: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<LocalSnapshot>;
      if (!parsed.settings || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.products)) {
        return { ok: false, error: 'Invalid JuiceFlow backup file.' };
      }
      setSettings({ ...createInitialSettings(), ...parsed.settings });
      setIngredients(parsed.ingredients);
      setProducts(parsed.products);
      setSales(Array.isArray(parsed.sales) ? parsed.sales : []);
      setExpenses(Array.isArray(parsed.expenses) ? parsed.expenses : []);
      setStockMovements(Array.isArray(parsed.stockMovements) ? parsed.stockMovements : []);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not parse JSON backup.' };
    }
  }, []);

  const resetDemoData = useCallback(() => {
    const seed = createSeedData();
    setIngredients(seed.ingredients);
    setProducts(seed.products);
    setSales(seed.sales);
    setExpenses(seed.expenses);
    setStockMovements(seed.stockMovements);
  }, []);

  const t = useMemo(() => getTranslations(settings.language), [settings.language]);

  const value: StoreContextValue = {
    settings,
    ingredients,
    products,
    sales,
    expenses,
    stockMovements,
    user,
    authReady,
    cloudSynced: Boolean(user && cloudWorkspaceId),
    syncing,
    t,
    setLanguage,
    setActiveOperator,
    updateSettings,
    saveProduct,
    deleteProduct,
    saveIngredient,
    deleteIngredient,
    recordIngredientPurchase,
    adjustIngredientStock,
    recordSale,
    voidSale,
    saveExpense,
    deleteExpense,
    signInWithGoogle,
    signOutGoogle,
    joinWorkspaceByCode,
    exportJsonBackup,
    importJsonBackup,
    resetDemoData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
