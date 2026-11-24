'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, getToken, removeToken, saveUser, setToken } from '@/lib/api';

/* ===================== TYPES ===================== */
type Screen = 'auth' | 'dash' | 'scan' | 'prev' | 'save' | 'ext' | 'bills' | 'cont' | 'cats' | 'shared';

const FIELDS: [string, string][] = [
  ['m', 'Merchant / business name'],
  ['date', 'Bill date'],
  ['no', 'Invoice / bill number'],
  ['total', 'Total amount'],
  ['tax', 'Tax amount'],
  ['items', 'Items (one per line)'],
  ['cur', 'Currency'],
  ['pay', 'Payment details'],
];

const EXPIRY_OPTS = ['Never', 'In 7 days', 'In 30 days', 'In 90 days'];

/* ===================== HELPERS ===================== */
const money = (v: string, c = 'INR') =>
  v ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: c || 'INR' }).format(+v) : '—';

const fdate = (d: string) =>
  d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const normalizeBill = (bill: any) => ({
  id: String(bill.id),
  m: bill.merchant || 'Unknown Merchant',
  no: bill.billNo || '',
  total: bill.total || '',
  tax: bill.tax || '',
  items: bill.items || '',
  cur: bill.currency || 'INR',
  pay: bill.payment || '',
  date: bill.date || '',
  added: bill.createdAt || '',
  cont: bill.view?.name || 'Unassigned',
  viewId: bill.view?.id || '',
  cat: bill.category || '',
  sub: bill.subcategory || '',
  pers: Boolean(bill.isPersonal),
  mimeType: bill.mimeType || '',
  st: bill.status === 'VERIFIED' ? 'Verified'
    : bill.status === 'PROCESSING' ? 'Processing'
      : bill.status === 'INVALID_DOCUMENT' ? 'Not a bill'
      : bill.status === 'READY_FOR_REVIEW' || bill.status === 'NEEDS_REVIEW' ? 'Needs review'
        : bill.status,
  img: '',
});

const normalizeExtraction = (extraction: any) => ({
  m: extraction?.merchant,
  date: extraction?.date,
  no: extraction?.billNo,
  total: extraction?.total,
  tax: extraction?.tax,
  items: extraction?.items,
  cur: extraction?.currency,
  pay: extraction?.payment,
});

const ini = (n: string) =>
  n.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase() || '?';

const NOW = new Date();

/* ===================== SVG ICONS ===================== */
const ShareIcon = () => (
  <svg className="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M2.5 20c0-3.6 2.8-6 6.5-6 1.5 0 2.8.4 3.9 1.1" />
    <circle cx="18" cy="17" r="4.2" />
    <path d="M18 15v4M16 17h4" />
  </svg>
);

const AppMark = ({ size = 28 }: { size?: number }) => (
  <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect className="mk-b" width="32" height="32" rx="8" />
    <path className="mk-r" d="M9.5 7h13v18l-2.17-1.6L18.17 25 16 23.4 13.83 25l-2.16-1.6L9.5 25z" />
    <path className="mk-l" d="M13 12h6M13 15.5h6M13 19h3.5" />
  </svg>
);

/* ===================== MAIN APP ===================== */
const QIcon = ({ name }: { name: 'star' | 'clock' | 'share' | 'trash' | 'more' }) => (
  <svg className="qi" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'star' && <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />}
    {name === 'clock' && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>}
    {name === 'share' && <><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" /></>}
    {name === 'trash' && <><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></>}
    {name === 'more' && <><circle cx="12" cy="5.5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="18.5" r="1.3" fill="currentColor" /></>}
  </svg>
);

export default function Home() {
  /* --- theme --- */
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  /* --- auth --- */
  const [isSignUp, setIsSignUp] = useState(false);
  const [signupMode, setSignupMode] = useState<'e' | 'm'>('e');
  const [authName, setAuthName] = useState('');
  const [authContact, setAuthContact] = useState('');
  const [signInId, setSignInId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [authMsgType, setAuthMsgType] = useState<'err' | 'info'>('err');
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingName, setPendingName] = useState('');

  /* --- user --- */
  const [user, setUser] = useState({ first: 'User', initials: 'U', name: 'User', id: '' });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  /* --- nav / screens --- */
  const [screen, setScreen] = useState<Screen>('auth');
  const [stack, setStack] = useState<Screen[]>([]);

  /* --- data --- */
  const [bills, setBills] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [conts, setConts] = useState<string[]>([]);
  const [cats, setCats] = useState<Record<string, string[]>>({});
  const [shares, setShares] = useState<Record<string, { id?: string; to: string; end: string }[]>>({});
  const [incomingShared, setIncomingShared] = useState<any[]>([]);

  /* --- scan --- */
  const [capturedImg, setCapturedImg] = useState('');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const capturedFileState = capturedFile;
  const [prevNote, setPrevNote] = useState('');
  const [camMsg, setCamMsg] = useState('');
  const [camActive, setCamActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const camInputRef = useRef<HTMLInputElement | null>(null);

  /* --- save screen --- */
  const [saveCont, setSaveCont] = useState('');
  const [saveCat, setSaveCat] = useState('');
  const [saveSub, setSaveSub] = useState('');
  const [savePers, setSavePers] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  /* --- OCR / ext --- */
  const [curBill, setCurBill] = useState<any>(null);
  const [ocrDone, setOcrDone] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [invalidDocument, setInvalidDocument] = useState(false);
  const [extFields, setExtFields] = useState<Record<string, { v: string; c: string; t: boolean }>>({});
  const [extCat, setExtCat] = useState('');
  const [extSub, setExtSub] = useState('');
  const [extCont, setExtCont] = useState('');
  const [extPers, setExtPers] = useState(false);
  const [extCatConf, setExtCatConf] = useState('');

  /* --- bills filters --- */
  const [q, setQ] = useState('');
  const [selViews, setSelViews] = useState<Set<string>>(new Set());
  const [msOpen, setMsOpen] = useState(false);
  const [mobileFilter, setMobileFilter] = useState<'views' | 'category' | 'date' | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsLoaded, setBillsLoaded] = useState(false);

  /* --- toast --- */
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* --- modal --- */
  const [modal, setModal] = useState<'none' | 'billDetail' | 'addBills' | 'share' | 'sharedBill'>('none');
  const [modalBill, setModalBill] = useState<any>(null);
  const [billFileStatus, setBillFileStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const [modalMoveTo, setModalMoveTo] = useState('');
  const [addBillsTo, setAddBillsTo] = useState('');
  const [shareKey, setShareKey] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [shareExpiry, setShareExpiry] = useState('Never');
  const [shareNewMode, setShareNewMode] = useState<'e' | 'm'>('e');
  const [shareNewVal, setShareNewVal] = useState('');
  const [shareRecipientSelection, setShareRecipientSelection] = useState('');
  const [pkMsg, setPkMsg] = useState('');
  const [sharedViewBill, setSharedViewBill] = useState<any>(null);

  /* --- views screen new view --- */
  const [newContName, setNewContName] = useState('');
  const [contMsg, setContMsg] = useState('');
  /* --- cats screen new cat --- */
  const [newCatName, setNewCatName] = useState('');
  const [catMsg, setCatMsg] = useState('');

  /* --- shared tab --- */
  const [sharedTab, setSharedTab] = useState<'me' | 'by'>('me');
  const [sharedView, setSharedView] = useState<number | 'all' | null>(null);

  /* --- dashboard / panels --- */
  const [moreOpen, setMoreOpen] = useState(false);
  const [panel, setPanel] = useState<'none' | 'scan' | 'fav' | 'deleted' | 'reports' | 'prefs' | 'range'>('none');
  const [dashTab, setDashTab] = useState<'fav' | 'recent' | 'shared' | 'deleted'>('recent');
  const [quickMore, setQuickMore] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ url: string; pdf: boolean; title: string } | null>(null);
  const [deletedBills, setDeletedBills] = useState<any[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [savingBill, setSavingBill] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const savingRef = useRef(false);

  const applyProfile = (profile: any) => {
    const name = profile?.name?.trim() || profile?.contact || 'User';
    const first = name.split(/\s+/)[0];
    const displayUser = {
      id: profile?.id || '',
      name,
      first,
      initials: ini(name),
    };
    setUser(displayUser);
    saveUser(profile);
  };

  const loadWorkspace = async () => {
    const [viewData, categoryData, billData, outgoing, incoming] = await Promise.all([
      api.getViews(),
      api.getCategories(),
      api.getBills(),
      api.getOutgoingShares(),
      api.getIncomingShares(),
    ]);

    setViews(viewData);
    setConts(viewData.map((view: any) => view.name));
    setCats(Object.fromEntries(categoryData.map((category: any) => [category.name, category.subcategories])));
    setBills(billData.map(normalizeBill));

    const outgoingShares: Record<string, { id?: string; to: string; end: string }[]> = {};
    outgoing.forEach((share: any) => {
      const targetName = share.targetType === 'bill'
        ? share.targetId
        : viewData.find((view: any) => view.id === share.targetId)?.name;
      if (!targetName) return;
      const key = `${share.targetType === 'bill' ? 'b' : 'v'}:${targetName}`;
      const end = share.expiresAt
        ? (() => {
            const days = Math.ceil((new Date(share.expiresAt).getTime() - Date.now()) / 864e5);
            return days <= 0 ? 'Expired' : `In ${days} days`;
          })()
        : 'Never';
      outgoingShares[key] = [...(outgoingShares[key] || []), {
        id: share.id,
        to: share.recipientContact,
        end,
      }];
    });
    setShares(outgoingShares);

    setIncomingShared(incoming.map((group: any) => ({
      ...group,
      bills: group.bills.map(normalizeBill),
    })));
  };

  const refreshBills = async () => {
    const data = await api.getBills();
    setBills(data.map(normalizeBill));
  };

  const refreshSharing = async () => {
    const [outgoing, incoming] = await Promise.all([
      api.getOutgoingShares(),
      api.getIncomingShares(),
    ]);
    const outgoingShares: Record<string, { id?: string; to: string; end: string }[]> = {};
    outgoing.forEach((share: any) => {
      const targetName = share.targetType === 'bill'
        ? share.targetId
        : views.find((view: any) => view.id === share.targetId)?.name;
      if (!targetName) return;
      const key = `${share.targetType === 'bill' ? 'b' : 'v'}:${targetName}`;
      const end = share.expiresAt
        ? (() => {
            const days = Math.ceil((new Date(share.expiresAt).getTime() - Date.now()) / 864e5);
            return days <= 0 ? 'Expired' : `In ${days} days`;
          })()
        : 'Never';
      outgoingShares[key] = [...(outgoingShares[key] || []), {
        id: share.id,
        to: share.recipientContact,
        end,
      }];
    });
    setShares(outgoingShares);
    setIncomingShared(incoming.map((group: any) => ({
      ...group,
      bills: group.bills.map(normalizeBill),
    })));
  };

  /* ===================== FAVOURITES (saved on this device) ===================== */
  const favKey = user.id ? `travelogue:favs:${user.id}` : '';
  useEffect(() => {
    if (!favKey) { setFavs(new Set()); return; }
    try { setFavs(new Set(JSON.parse(localStorage.getItem(favKey) || '[]'))); } catch { setFavs(new Set()); }
  }, [favKey]);

  const toggleFav = (id: string) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { if (favKey) localStorage.setItem(favKey, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      return next;
    });
  };

  /* ===================== THUMBNAILS ===================== */
  const thumbLoading = useRef<Set<string>>(new Set());
  const loadThumb = async (b: any) => {
    const id = String(b.id);
    if (thumbs[id] || thumbLoading.current.has(id) || b.st === 'Processing') return;
    thumbLoading.current.add(id);
    try {
      const file = await api.getBillFile(id);
      const url = file.type === 'application/pdf' ? 'pdf' : URL.createObjectURL(file);
      setThumbs(prev => ({ ...prev, [id]: url }));
    } catch {
      setThumbs(prev => ({ ...prev, [id]: 'error' }));
    }
  };

  const openViewer = async (b: any) => {
    try {
      const file = await api.getBillFile(String(b.id));
      setViewer({ url: URL.createObjectURL(file), pdf: file.type === 'application/pdf', title: b.m });
    } catch (error) {
      toast(`Could not load bill image: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const closeViewer = () => {
    if (viewer?.url.startsWith('blob:')) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  };

  /* ===================== DELETED BILLS ===================== */
  const loadDeleted = async () => {
    setDeletedLoading(true);
    try {
      const data = await api.getBills({ deleted: true });
      setDeletedBills(data.map(normalizeBill));
    } catch (error) {
      toast(`Could not load deleted bills: ${error instanceof Error ? error.message : 'Request failed'}`);
    } finally {
      setDeletedLoading(false);
    }
  };

  const openPanel = (p: 'scan' | 'fav' | 'deleted' | 'reports' | 'prefs' | 'range') => {
    setMoreOpen(false);
    setQuickMore(false);
    setProfileMenuOpen(false);
    setPanel(p);
    if (p === 'deleted') void loadDeleted();
  };

  const deleteBill = (b: any) => setConfirmDel(b);
  const confirmDeleteBill = async () => {
    const b = confirmDel;
    setConfirmDel(null);
    if (!b) return;
    try {
      await api.deleteBill(String(b.id));
      setModal('none');
      await refreshBills();
      if (dashTab === 'deleted') void loadDeleted();
      toast('Bill moved to Deleted bills');
    } catch (error) {
      toast(`Could not delete bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const restoreBill = async (b: any) => {
    try {
      await api.restoreBill(String(b.id));
      await Promise.all([loadDeleted(), refreshBills()]);
      toast('Bill restored');
    } catch (error) {
      toast(`Could not restore bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const deleteForever = async (b: any) => {
    if (!window.confirm(`Permanently delete the bill from ${b.m}? This also deletes its image and cannot be undone.`)) return;
    try {
      await api.deleteBill(String(b.id), true);
      await loadDeleted();
      toast('Bill deleted permanently');
    } catch (error) {
      toast(`Could not delete bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  /* ===================== THEME ===================== */
  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
    const pref = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme((stored || pref) as 'light' | 'dark');
  }, []);

  useEffect(() => () => {
    if (capturedImg.startsWith('blob:')) URL.revokeObjectURL(capturedImg);
  }, [capturedImg]);

  useEffect(() => () => {
    [modalBill?.img, sharedViewBill?.img]
      .filter((url): url is string => typeof url === 'string' && url.startsWith('blob:'))
      .forEach((url) => URL.revokeObjectURL(url));
  }, [modalBill?.img, sharedViewBill?.img]);

  const applyTheme = (t: 'light' | 'dark') => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { }
  };

  const toggleTheme = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    api.getMe()
      .then(async (profile) => {
        if (!active) return;
        applyProfile(profile);
        await loadWorkspace();
        if (active) setScreen('dash');
      })
      .catch((error) => {
        if (active) {
          setAuthMsg(`Could not restore your session: ${error.message}`);
          setAuthMsgType('err');
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    if (screen === 'bills') {
      refreshBills().catch((error) => toast(`Could not load bills: ${error.message}`));
    } else if (screen === 'shared') {
      refreshSharing().catch((error) => toast(`Could not load shares: ${error.message}`));
    }
  }, [screen]);

  /* ===================== TOAST ===================== */
  const toast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  /* ===================== NAVIGATION ===================== */
  const stopCam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCamActive(false);
  };

  const show = useCallback((id: Screen, back = false) => {
    stopCam();
    setMobileFilter(null);
    setStack(prev => {
      if (!back && screen !== 'auth' && screen !== id && id !== 'dash') return [...prev, screen];
      if (id === 'dash') return [];
      return prev;
    });
    setScreen(id);
    // Reset per-screen state
    if (id === 'save') {
      setSaveCont('');
      setSaveCat('');
      setSaveSub('');
      setSavePers(false);
      setSaveMsg('');
    }
    if (id === 'bills' && !billsLoaded) {
      setBillsLoading(true);
      setBillsLoaded(true);
      setTimeout(() => setBillsLoading(false), 600);
    }
    if (id === 'shared') {
      setSharedView(null);
    }
    window.scrollTo(0, 0);
  }, [screen, billsLoaded]);

  const goBack = () => {
    setStack(prev => {
      const next = [...prev];
      const target = next.pop() || 'dash';
      show(target as Screen, true);
      return next;
    });
  };

  const NAV_ITEMS = [
    { id: 'dash', label: 'Dashboard', icon: '⌂' },
    { id: 'bills', label: 'My Bills', icon: '▤' },
    { id: 'cont', label: 'Views', icon: '▣' },
    { id: 'cats', label: 'Categories', icon: '≡' },
    { id: 'shared', label: 'Shared', icon: '⇄' },
  ] as const;

  /* ===================== AUTH ===================== */
  const toggleAuth = () => {
    setIsSignUp(v => !v);
    setAuthMsg('');
    setPendingName('');
  };

  const signupCheck = (): string | false => {
    if (!isSignUp) return '';
    const n = authName.trim();
    const c = authContact.trim();
    if (n.length < 2) { setAuthMsg('Enter your full name.'); setAuthMsgType('err'); return false; }
    if (signupMode === 'e') {
      if (c.indexOf('@') < 1 || c.lastIndexOf('.') < c.indexOf('@') + 2 || c.length < 6) {
        setAuthMsg('Enter a valid email address.'); setAuthMsgType('err'); return false;
      }
    } else {
      const digits = c.replace(/\D/g, '');
      const validIndianNumber = (digits.length === 10 && /^[6-9]\d{9}$/.test(digits))
        || (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2)));
      if (!validIndianNumber) {
        setAuthMsg('Enter a valid Indian WhatsApp number, with or without the +91 country code.');
        setAuthMsgType('err');
        return false;
      }
    }
    setPendingName(n);
    if (signupMode === 'm') {
      const digits = c.replace(/\D/g, '');
      return digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }
    return c;
  };

  const sendOtp = async () => {
    const sg = signupCheck();
    if (sg === false) return;
    let v = sg || signInId.trim();
    if (!isSignUp && signupMode === 'e' && !/^\S+@\S+\.\S+$/.test(v)) {
      setAuthMsg('Enter a valid email address.');
      setAuthMsgType('err');
      return;
    }
    if (!isSignUp && signupMode === 'm') {
      const digits = v.replace(/\D/g, '');
      const validIndianNumber = (digits.length === 10 && /^[6-9]\d{9}$/.test(digits))
        || (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2)));
      if (!validIndianNumber) {
        setAuthMsg('Enter a valid Indian WhatsApp number, with or without the +91 country code.');
        setAuthMsgType('err');
        return;
      }
      v = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }
    setAuthLoading(true); setAuthMsg('');
    try {
      const result = await api.sendOtp(v, isSignUp ? authName.trim() : undefined);
      setSentTo(v);
      setOtpSent(true);
      setOtpNotice(result.message || `A code was sent to ${v}.`);
    } catch (error) {
      setAuthMsg(error instanceof Error ? error.message : 'Could not send the code.');
      setAuthMsgType('err');
    } finally {
      setAuthLoading(false);
    }
  };

  const verify = async () => {
    setAuthLoading(true); setAuthMsg('');
    try {
      const result = await api.verifyOtp(sentTo, otp.trim());
      setToken(result.accessToken);
      applyProfile(result.user);
      await loadWorkspace();
      setOtp('');
      setOtpSent(false);
      setPendingName('');
      show('dash');
      toast(isSignUp ? 'Account created' : 'Signed in');
    } catch (error) {
      setAuthMsg(error instanceof Error ? error.message : 'Could not verify the code.');
      setAuthMsgType('err');
    } finally {
      setAuthLoading(false);
    }
  };

  /* ===================== SCAN / CAMERA ===================== */
  // Scan button: let the user choose camera or gallery.
  const goScan = () => openPanel('scan');

  // "Take a photo": full-screen in-app camera (live preview + shutter) on phones and laptops.
  // Falls back to the phone's own camera app when live camera access is unavailable.
  const goLiveCam = () => {
    setPanel('none');
    show('scan');
    setCamActive(false);
    setCamMsg('');
    setTimeout(async () => {
      setCamMsg('<spin>');
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamMsg('err:This browser cannot open the camera here. Use your phone camera app or choose a photo from the gallery.');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
        }
        setCamActive(true);
        setCamMsg('');
      } catch {
        setCamMsg('err:Camera access was blocked or is unavailable. Allow camera permission in your browser settings, or use your phone camera app.');
      }
    }, 50);
  };

  const goUpload = () => {
    setPanel('none');
    fileInputRef.current!.value = '';
    fileInputRef.current!.click();
  };

  // Native camera app via <input capture> (fallback when live camera is unavailable).
  const openNativeCam = () => {
    setPanel('none');
    camInputRef.current!.value = '';
    camInputRef.current!.click();
  };

  // Phones/tablets open the built-in camera app; the in-browser camera needs HTTPS and fails on phones.
  const openCam = () => {
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (touch || !navigator.mediaDevices?.getUserMedia) openNativeCam();
    else goLiveCam();
  };

  const capture = () => {
    const v = videoRef.current!;
    if (!v.videoWidth || !v.videoHeight) {
      setCamMsg('err:The camera is not ready yet. Wait for the preview and try again.');
      return;
    }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) {
        setCamMsg('err:Could not capture the photo. Try again.');
        return;
      }
      setCapturedFile(new File([blob], `bill-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setCapturedImg(URL.createObjectURL(blob));
      setPrevNote('Photo captured with your camera.');
      show('prev');
    }, 'image/jpeg', 0.85);
  };

  // Phone photos are often stored sideways with an EXIF "rotate" flag that OCR ignores,
  // and can be very large. Redraw upright and scale down before uploading.
  const normalizePhoto = async (f: File): Promise<File> => {
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(f.type)) return f;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9));
      return blob ? new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
    } catch {
      return f;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    const fromCamera = e.target === camInputRef.current;
    const f = await normalizePhoto(picked);
    if (f.size > 10 * 1048576) {
      toast('That file is larger than 10 MB. Choose a smaller file.');
      return;
    }
    if (!/^image\//.test(f.type) && f.type !== 'application/pdf') {
      toast('Choose a bill image or PDF file.');
      return;
    }
    setCapturedFile(f);
    if (f.type === 'application/pdf') {
      setCapturedImg(URL.createObjectURL(f));
      setPrevNote(`PDF selected: ${f.name}. Continue to upload it for processing.`);
      show('prev');
      return;
    }
    setCapturedImg('');
    const r = new FileReader();
    r.onload = () => {
      setCapturedImg(r.result as string);
      setPrevNote('Uploaded: ' + f.name);
      // A photo just taken with the camera goes straight to OCR; gallery picks get a check first.
      if (fromCamera) void uploadAndExtract({}, f);
      else show('prev');
    };
    r.readAsDataURL(f);
  };

  /* ===================== SAVE SCREEN ===================== */
  const fillSub = (k: string) => {
    setSaveCat(k);
    setSaveSub(cats[k]?.[0] || '');
  };

  const uploadAndExtract = async (selection: { view?: string; category?: string; subcategory?: string; isPersonal?: boolean } = {}, fileOverride?: File) => {
    const capturedFile = fileOverride || capturedFileState;
    if (!capturedFile) {
      setOcrError('Choose or capture a bill before continuing.');
      return;
    }

    setOcrError('');
    setInvalidDocument(false);
    setCurBill(null);
    setExtFields({});
    show('ext');
    setOcrDone(false);

    try {
      const formData = new FormData();
      formData.append('file', capturedFile);
      const selectedView = views.find((view: any) => view.name === selection.view);
      if (selectedView) formData.append('viewId', selectedView.id);
      if (selection.category) formData.append('category', selection.category);
      if (selection.subcategory) formData.append('subcategory', selection.subcategory);
      if (selection.isPersonal !== undefined) formData.append('isPersonal', String(selection.isPersonal));

      const upload = await api.uploadBill(formData);
      const billId = String(upload.billId);
      const pendingBill = normalizeBill({
        id: billId,
        status: 'PROCESSING',
        view: selectedView ? { id: selectedView.id, name: selectedView.name } : null,
        category: selection.category,
        subcategory: selection.subcategory,
        isPersonal: selection.isPersonal,
      });
      setCurBill({ id: billId, img: capturedImg });
      setBills((current) => [...current.filter((bill) => bill.id !== billId), pendingBill]);

      let result: any;
      for (let attempt = 0; attempt < 20; attempt++) {
        result = await api.getExtraction(billId);
        if (result.status !== 'PROCESSING') break;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      if (!result || result.status === 'PROCESSING') {
        throw new Error('Bill processing is taking longer than expected. Open My bills and try again shortly.');
      }

      const source = result.extraction;
      const isInvalidDocument = source?.isReceipt === false;
      const values = normalizeExtraction(isInvalidDocument ? null : source);
      const extractionFields: Record<string, { v: string; c: string; t: boolean }> = {};
      FIELDS.forEach(([key]) => {
        const field = values[key];
        extractionFields[key] = {
          v: field?.value || '',
          c: field?.confidence || 'missing',
          t: false,
        };
      });
      // Currency always defaults to INR; the user can change it in the Amount editor.
      extractionFields.cur = { v: 'INR', c: 'found', t: false };
      const detectedCategory = source?.suggestedCategory || selection.category || result.category || 'Meals';
      setExtFields(extractionFields);
      setInvalidDocument(isInvalidDocument);
      setExtCat(detectedCategory);
      setExtSub(source?.suggestedSubcategory || result.subcategory || selection.subcategory || cats[detectedCategory]?.[0] || 'Team Meals');
      setExtCont(selection.view || result.currentView?.name || conts[0] || '');
      setExtPers(selection.isPersonal ?? result.isPersonal ?? false);
      setExtCatConf(source?.categoryConfidence || 'found');
      setOcrError(source?.error || '');
      setOcrDone(true);
      await refreshBills();
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'Bill upload or extraction failed.');
      setOcrDone(true);
    }
  };

  const saveBill = () => {
    if (!saveCont || !saveCat || !saveSub) {
      setSaveMsg('Select a view, category and subcategory to save this bill.');
      return;
    }
    void uploadAndExtract({ view: saveCont, category: saveCat, subcategory: saveSub, isPersonal: savePers });
  };

  /* ===================== OCR / EXT ===================== */
  const startExtract = () => void uploadAndExtract();

  const editField = (k: string, v: string) => {
    setExtFields(prev => ({ ...prev, [k]: { ...prev[k], v, t: true } }));
  };

  const confirmExt = async () => {
    if (invalidDocument) {
      setOcrError('This upload was not recognized as a bill or receipt and cannot be saved as an expense. Upload a clear bill, invoice, or receipt instead.');
      return;
    }
    if (!curBill?.id) {
      setOcrError('Upload the bill before saving its details.');
      return;
    }
    if (savingRef.current) return;
    const viewId = views.find((view: any) => view.name === extCont)?.id;
    savingRef.current = true;
    setSavingBill(true);
    try {
      const result = await api.confirmBill(curBill.id, {
        merchant: extFields.m?.v || '',
        date: extFields.date?.v || '',
        billNo: extFields.no?.v || '',
        total: extFields.total?.v || '',
        tax: extFields.tax?.v || '',
        currency: extFields.cur?.v || 'INR',
        payment: extFields.pay?.v || '',
        items: extFields.items?.v || '',
        viewId,
        category: extCat || 'Meals',
        subcategory: extSub || 'Team Meals',
        isPersonal: extPers,
      });
      await refreshBills();
      toast(result.status === 'VERIFIED' ? 'Bill saved' : 'Saved. Some details still need review');
      show('bills');
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'Could not save bill details.');
    } finally {
      savingRef.current = false;
      setSavingBill(false);
    }
  };

  // Cancel on the review screen: the upload already created the bill, so remove it and its file.
  const cancelReview = async () => {
    if (savingRef.current) return;
    const edited = Object.values(extFields).some((f: any) => f?.t);
    if (!window.confirm(edited
      ? 'Discard this bill and your edits? The scanned image will be deleted.'
      : 'Discard this bill? The scanned image will be deleted.')) return;
    const id = curBill?.id;
    savingRef.current = true;
    setSavingBill(true);
    setDiscarding(true);
    try {
      if (id) {
        await api.deleteBill(String(id));
        await api.deleteBill(String(id), true);
      }
      await refreshBills().catch(() => undefined);
      toast('Bill discarded');
      show('dash');
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'Could not discard the bill.');
    } finally {
      savingRef.current = false;
      setSavingBill(false);
      setDiscarding(false);
    }
  };

  /* ===================== EDIT POPUP (review screen) ===================== */
  const toIsoDate = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!m) return '';
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };

  const openEdit = (key: string) => {
    const f = (k: string) => extFields[k]?.v || '';
    const drafts: Record<string, Record<string, string>> = {
      date: { date: toIsoDate(f('date')) },
      amount: { total: f('total'), cur: f('cur') || 'INR' },
      no: { no: f('no') },
      m: { m: f('m') },
      tax: { tax: f('tax') },
      pay: { pay: f('pay') },
      items: { items: f('items') },
      cat: { cat: extCat, sub: extSub },
      view: { view: extCont, pers: extPers ? 'personal' : 'business' },
    };
    setEditDraft(drafts[key] || {});
    setEditKey(key);
  };

  const saveEdit = () => {
    const d = editDraft;
    if (editKey === 'cat') {
      if (d.cat !== extCat || d.sub !== extSub) setExtCatConf('edited');
      setExtCat(d.cat || '');
      setExtSub(d.sub || '');
    } else if (editKey === 'view') {
      setExtCont(d.view || '');
      setExtPers(d.pers === 'personal');
    } else {
      Object.entries(d).forEach(([k, v]) => {
        if ((extFields[k]?.v || '') !== v) editField(k, v);
      });
    }
    setEditKey(null);
  };


  /* ===================== BILLS FILTERS ===================== */
  const msLabel = () => {
    if (selViews.size === 0) return 'All views';
    if (selViews.size === 1) return [...selViews][0];
    return selViews.size + ' views selected';
  };

  const msToggle = (v: string, checked: boolean) => {
    setSelViews(prev => { const n = new Set(prev); checked ? n.add(v) : n.delete(v); return n; });
  };

  const msSelectAll = () => setSelViews(new Set(conts));
  const msClear = () => setSelViews(new Set());

  const dOk = (b: any, d: string) => {
    if (!d) return true;
    if (!b.date) return false;
    const x = new Date(b.date + 'T00:00');
    if (d === '30') { const n = (NOW.getTime() - x.getTime()) / 864e5; return n >= 0 && n <= 30; }
    if (d === 'prev') {
      const p = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
      return x.getFullYear() === p.getFullYear() && x.getMonth() === p.getMonth();
    }
    if (d === 'custom') { return (!filterFrom || b.date >= filterFrom) && (!filterTo || b.date <= filterTo); }
    return true;
  };

  const filteredBills = bills.filter(b =>
    (!q || (b.m + b.no).toLowerCase().includes(q.toLowerCase())) &&
    (!selViews.size || selViews.has(b.cont)) &&
    (!filterCat || b.cat === filterCat) &&
    dOk(b, filterDate)
  );

  const clearFilters = () => {
    setQ(''); setFilterCat(''); setFilterDate(''); setFilterFrom(''); setFilterTo('');
    setSelViews(new Set());
  };

  const logout = () => {
    stopCam();
    setProfileMenuOpen(false);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    removeToken();
    setUser({ first: 'User', initials: 'U', name: 'User', id: '' });
    setBills([]);
    setViews([]);
    setConts([]);
    setCats({});
    setShares({});
    setDashTab('recent');
    setRangeFrom('');
    setRangeTo('');
    setConfirmDel(null);
    setIncomingShared([]);
    setStack([]);
    setPanel('none');
    setMoreOpen(false);
    setThumbs({});
    setViewer(null);
    setEditKey(null);
    setScreen('auth');
    setModal('none');
    setModalBill(null);
    setSharedViewBill(null);
    setCapturedImg('');
    setCapturedFile(null);
    setMobileFilter(null);
    setMsOpen(false);
    setOtp('');
    setOtpSent(false);
    setSentTo('');
    setPendingName('');
    setAuthMsg('');
    setToastMsg('');
  };

  /* ===================== BILL DETAIL ===================== */
  const openBillModal = async (id: string | number) => {
    const b = bills.find(x => String(x.id) === String(id));
    if (!b) return;
    if (b.st === 'Processing') { toast('This bill is still being processed'); return; }
    setModalBill(b);
    setBillFileStatus('loading');
    setModalMoveTo(b.cont);
    setModal('billDetail');
    try {
      const file = await api.getBillFile(String(b.id));
      setModalBill((current: any) => current?.id === b.id
        ? { ...current, img: URL.createObjectURL(file), mimeType: file.type }
        : current);
      setBillFileStatus('ready');
    } catch (error) {
      setBillFileStatus('error');
      toast(`Could not load bill file: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const openSharedBill = async (bill: any) => {
    setSharedViewBill(bill);
    setBillFileStatus('loading');
    setModal('sharedBill');
    try {
      const file = await api.getBillFile(String(bill.id));
      setSharedViewBill((current: any) => current?.id === bill.id
        ? { ...current, img: URL.createObjectURL(file), mimeType: file.type }
        : current);
      setBillFileStatus('ready');
    } catch (error) {
      setBillFileStatus('error');
      toast(`Could not load shared bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const downloadBill = async (bill: any) => {
    try {
      const file = await api.getBillFile(String(bill.id));
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${bill.m || 'bill'}-${bill.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(`Could not download bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  const moveBill = async () => {
    if (!modalBill) return;
    const v = modalMoveTo;
    if (v === modalBill.cont) { setModal('none'); return; }
    const view = views.find((item: any) => item.name === v);
    if (!view) { toast('Choose a valid view.'); return; }
    try {
      await api.moveBill(modalBill.id, view.id);
      await refreshBills();
      setModal('none');
      toast('Moved to ' + v);
    } catch (error) {
      toast(`Could not move bill: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  /* ===================== VIEWS SCREEN ===================== */
  const addView = async () => {
    const v = newContName.trim();
    if (!v) { setContMsg('Enter a name for the view.'); return; }
    if (conts.some(c => c.toLowerCase() === v.toLowerCase())) { setContMsg('A view with this name already exists.'); return; }
    try {
      const created = await api.createView(v);
      setViews((current) => [...current, created]);
      setConts((current) => [...current, created.name]);
      setNewContName('');
      setContMsg('');
      toast('View created');
      if (bills.length) { setAddBillsTo(created.name); setModal('addBills'); }
    } catch (error) {
      setContMsg(error instanceof Error ? error.message : 'Could not create view.');
    }
  };

  /* ===================== CATEGORIES SCREEN ===================== */
  const addCat = async () => {
    const v = newCatName.trim();
    if (!v) { setCatMsg('Enter a name for the category.'); return; }
    if (cats[v]) { setCatMsg('This category already exists.'); return; }
    try {
      const created = await api.createCategory(v);
      setCats((current) => ({ ...current, [created.name]: created.subcategories }));
      setNewCatName('');
      setCatMsg('');
      toast('Category added');
    } catch (error) {
      setCatMsg(error instanceof Error ? error.message : 'Could not add category.');
    }
  };

  /* ===================== NAVIGATE TO BILLS WITH FILTER ===================== */
  const goBills = (filterType: 'view' | 'cat', value: string) => {
    setQ(''); setFilterCat(''); setFilterDate(''); setFilterFrom(''); setFilterTo('');
    setSelViews(new Set());
    if (filterType === 'view') setSelViews(new Set([value]));
    if (filterType === 'cat') setFilterCat(value);
    show('bills');
  };

  /* ===================== ADD BILLS TO VIEW ===================== */
  const openAddBills = (c: string) => {
    setAddBillsTo(c);
    setPkMsg('');
    setModal('addBills');
  };

  const confirmAddBills = async () => {
    const checked = document.querySelectorAll('.pick-cb:checked');
    const ids = Array.from(checked).map(el => (el as HTMLInputElement).value);
    if (!ids.length) { setPkMsg('Select at least one bill.'); return; }
    const view = views.find((item: any) => item.name === addBillsTo);
    if (!view) { setPkMsg('The selected view is no longer available.'); return; }
    try {
      await api.addBillsToView(view.id, ids);
      await refreshBills();
      setModal('none');
      toast(ids.length + ' bill' + (ids.length > 1 ? 's' : '') + ' added to ' + addBillsTo);
    } catch (error) {
      setPkMsg(error instanceof Error ? error.message : 'Could not add bills to this view.');
    }
  };

  /* ===================== SHARE ===================== */
  const shRecips = (key: string) => {
    const k = key[0];
    const id = key.slice(2);
    const a = (shares[key] || []).filter((x) => x.end !== 'Expired').map((x, i) => ({ ...x, idx: i })) as any[];
    if (k === 'b') {
      const b = bills.find(x => String(x.id) === id);
      if (b) {
        (shares['v:' + b.cont] || []).filter(x => x.end !== 'Expired').forEach(x => {
          if (!a.some((y: any) => y.to === x.to)) a.push({ ...x, via: b.cont });
        });
      }
    }
    return a;
  };

  const openShare = (k: string, id: string | number) => {
    setShareKey(k + ':' + id);
    setShareExpiry('Never');
    setShareMsg('');
    setShareNewVal('');
    setShareRecipientSelection('');
    setShareNewMode('e');
    setProfileMenuOpen(false);
    setModal('share');
  };

  const doShare = async () => {
    const recipient = (shareRecipientSelection === '__new__' ? shareNewVal : shareRecipientSelection).trim();
    if (!recipient) {
      setShareMsg('Select a person or choose Add someone new.');
      return;
    }
    let to = recipient;
    if (shareNewMode === 'e') {
      if (!/^\S+@\S+\.\S+$/.test(recipient)) {
        setShareMsg('Enter a valid email address.');
        return;
      }
      to = recipient.toLowerCase();
    } else {
      const digits = recipient.replace(/\D/g, '');
      const validIndianNumber = (digits.length === 10 && /^[6-9]\d{9}$/.test(digits))
        || (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2)));
      if (!validIndianNumber) {
        setShareMsg('Enter a valid Indian WhatsApp number, with or without the +91 country code.');
        return;
      }
      to = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }
    const targetType = shareKey.startsWith('b:') ? 'bill' : 'view';
    const targetId = targetType === 'bill'
      ? shareId
      : views.find((view: any) => view.name === shareId)?.id;
    if (!targetId) { setShareMsg('The selected bill or view is no longer available.'); return; }
    const cOf = { name: to, email: to };
    const expiresInDays = shareExpiry === 'In 7 days' ? 7 : shareExpiry === 'In 30 days' ? 30 : shareExpiry === 'In 90 days' ? 90 : undefined;
    try {
      await api.createShare({
        targetType,
        targetId,
        recipientContact: to,
        expiresInDays,
      });
      await refreshSharing();
      setShareMsg('Shared with ' + cOf.name);
      toast('Shared with ' + cOf.name);
    } catch (error) {
      setShareMsg(error instanceof Error ? error.message : 'Could not share this item.');
    }
  };

  const unshare = async (shareId: string) => {
    try {
      await api.removeShare(shareId);
      await refreshSharing();
      toast('Access removed');
    } catch (error) {
      toast(`Could not remove access: ${error instanceof Error ? error.message : 'Request failed'}`);
    }
  };

  /* ===================== SHARED SCREEN ===================== */
  const byMe = () => {
    const m: Record<string, Map<string, any>> = {};
    Object.keys(shares).forEach(key => {
      const k = key[0];
      const id = key.slice(2);
      const bl = k === 'b' ? bills.filter(b => String(b.id) === id) : bills.filter(b => b.cont === id && b.st !== 'Processing');
      (shares[key] || []).forEach(x => {
        if (x.end === 'Expired') return;
        m[x.to] = m[x.to] || new Map();
        bl.forEach(b => m[x.to].set(b.id, b));
      });
    });
    const cOf = (email: string) => ({ name: email, email });
    return Object.entries(m).map(([to, mp]) => ({ who: cOf(to), bills: [...mp.values()] })).filter(e => e.bills.length);
  };

  /* ===================== CLOSE MODAL ON BACKDROP ===================== */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.ms') && msOpen) setMsOpen(false);
      if (!(e.target as HTMLElement).closest('.profile-menu-wrap')) setProfileMenuOpen(false);
    };
    const kHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMsOpen(false);
        setMobileFilter(null);
        setProfileMenuOpen(false);
        setModal('none');
      }
    };
    document.addEventListener('click', handler);
    document.addEventListener('keydown', kHandler);
    return () => { document.removeEventListener('click', handler); document.removeEventListener('keydown', kHandler); };
  }, [msOpen]);

  useEffect(() => {
    if (modal === 'none') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modal]);

  useEffect(() => {
    if (!mobileFilter) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileFilter]);

  const recentBills = bills.filter(b => b.st !== 'Processing').slice(0, 8);
  useEffect(() => {
    if (screen !== 'dash' && panel !== 'fav') return;
    const wanted = panel === 'fav' || dashTab === 'fav' ? bills.filter(b => favs.has(String(b.id)))
      : dashTab === 'shared' ? bills.filter(b => shRecips('b:' + b.id).length > 0)
      : rangeFrom || rangeTo ? bills.filter(b => b.st !== 'Processing') : recentBills;
    wanted.forEach(b => { void loadThumb(b); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, panel, bills, favs, dashTab, rangeFrom, rangeTo]);

  useEffect(() => {
    if (panel === 'none' && !viewer && !editKey) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [panel, viewer, editKey]);

  /* ===================== RENDER HELPERS ===================== */
  const isAuth = screen === 'auth';
  // Main sections are reached from the nav; Back is only for sub-screens (photo check, save, review).
  const showBack = !['auth', 'dash', 'bills', 'cont', 'cats', 'shared'].includes(screen);
  const navActive = (id: string) => screen === id || (screen === 'ext' && id === 'bills');

  const BillItem = ({ b }: { b: any }) => {
    const n = shRecips('b:' + b.id).length;
    return (
      <div className="ir">
        <button className="item" onClick={() => openBillModal(b.id)}>
          <div className="bill-file-placeholder" aria-hidden="true">▤</div>
          <span className="g">
            <b>{b.m}</b>
            <span className="sm mut">{fdate(b.date)} · {b.cat} · {b.cont}</span>
          </span>
          <span style={{ textAlign: 'right', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
            <span className="amt">{money(b.total, b.cur)}</span>
            <br />
            <span className={'pill ' + (b.st === 'Verified' ? 'ok' : b.st === 'Processing' ? '' : 'warn')}>{b.st}</span>
          </span>
        </button>
        <button className="btn shr" onClick={() => openShare('b', b.id)} title={n ? 'Shared with ' + n + (n === 1 ? ' person' : ' people') : 'Not shared yet'}>
          <ShareIcon />
          <span>Share</span>
          {n ? <span className="sbadge">{n}</span> : null}
        </button>
      </div>
    );
  };

  const cOf = (email: string) => ({ name: email, email });

  /* ===================== SHARED TAB RENDERS ===================== */
  const RowBill = ({ b, own }: { b: any; own: boolean }) => (
    <button className="mini" onClick={() => {
      if (own) openBillModal(b.id);
      else void openSharedBill(b);
    }}>
      <span className="g"><b>{b.m}</b><span className="sm mut">{fdate(b.date)} · {b.sub}</span></span>
      <span className="amt">{money(b.total, b.cur)}</span>
    </button>
  );

  const GroupCard = ({ entry, own }: { entry: { who: { name: string; email: string }; bills: any[] }; own: boolean }) => {
    const bc: Record<string, any[]> = {};
    entry.bills.forEach(b => { (bc[b.cat] = bc[b.cat] || []).push(b); });
    return (
      <div className="card grp">
        <div className="gh">
          <i className="av">{ini(entry.who.name)}</i>
          <span className="g">
            <b>{entry.who.name}</b>
            <span className="sm mut" style={{ overflowWrap: 'anywhere' }}>{entry.who.email.includes('@') ? entry.who.email : 'WhatsApp: ' + entry.who.email}</span>
          </span>
          <span className="pill acc">{entry.bills.length} bill{entry.bills.length === 1 ? '' : 's'}</span>
        </div>
        {Object.entries(bc).map(([cat, bls]) => (
          <div key={cat} className="gc">
            <div className="gt"><b>{cat}</b><span className="pill">{bls.length} bill{bls.length === 1 ? '' : 's'}</span></div>
            {bls.map(b => <RowBill key={b.id} b={b} own={own} />)}
          </div>
        ))}
      </div>
    );
  };

  /* ===================== RENDER SHARE MODAL ===================== */
  const shareType = shareKey[0];
  const shareId = shareKey.slice(2);
  const shareTitle = shareType === 'b' ? 'Share bill' : 'Share view';
  const shareSub = shareType === 'b'
    ? (() => { const b = bills.find(x => String(x.id) === shareId); return b ? b.m + ' · ' + fdate(b.date) : ''; })()
    : (() => { const n = bills.filter(x => x.cont === shareId).length; return shareId + ' · ' + n + ' bill' + (n === 1 ? '' : 's'); })();
  const sharedWith = shRecips(shareKey);
  const knownShareContacts = [...new Set(Object.values(shares).flat().map((share) => share.to))].sort();

  /* ===================== RENDER REVIEW (after OCR) ===================== */
  const badgeFor = (k: string) => {
    const x = extFields[k] || { v: '', c: 'missing', t: false };
    if (x.t) return { cls: 'acc', txt: 'Edited' };
    if (!x.v) return { cls: 'err', txt: 'Missing' };
    return x.c === 'found' ? { cls: 'ok', txt: 'Found' } : { cls: 'warn', txt: 'Check' };
  };

  // Compact tile for the key fields: tap anywhere on it to edit.
  const Tile = ({ label, value, editKey: k, badgeKey, wide }: { label: string; value: string; editKey?: string; badgeKey?: string; wide?: boolean }) => {
    const badge = badgeKey ? badgeFor(badgeKey) : null;
    const body = (
      <>
        <span className="tl">
          {label}
          {badge && <i className={`dot ${badge.cls}`} title={badge.txt} aria-label={badge.txt} />}
        </span>
        <b className={value ? '' : 'mut'}>{value || 'Add'}</b>
        {k ? <span className="tp" aria-hidden="true">✎</span> : <span className="tp" aria-hidden="true">🔒</span>}
      </>
    );
    return k
      ? <button type="button" className={`tile${wide ? ' wide' : ''}`} onClick={() => openEdit(k)} aria-label={`Edit ${label}: ${value || 'empty'}`}>{body}</button>
      : <div className={`tile locked${wide ? ' wide' : ''}`}>{body}</div>;
  };

  const renderReview = () => {
    const f = (k: string) => extFields[k]?.v || '';
    const isPdf = capturedFile?.type === 'application/pdf';
    const needCheck = ['date', 'total', 'no', 'm', 'tax', 'pay', 'items'].filter(k => badgeFor(k).cls !== 'ok' && badgeFor(k).cls !== 'acc').length;
    return (
      <>
        {ocrError && <div className="msg err" role="alert">{ocrError}</div>}
        <div className="rv-head">
          <button type="button" className="thumb" onClick={() => capturedImg && setViewer({ url: capturedImg, pdf: isPdf, title: 'Scanned bill' })} aria-label="View scanned bill">
            {isPdf ? <span>PDF</span> : capturedImg ? <img src={capturedImg} alt="" /> : <span>▤</span>}
          </button>
          <div className="g">
            <button type="button" className="rv-merchant" onClick={() => openEdit('m')} aria-label="Edit business name">
              <b>{f('m') || 'Add business name'}</b><span aria-hidden="true">✎</span>
            </button>
            <span className="sm mut">{needCheck ? `${needCheck} field${needCheck === 1 ? '' : 's'} to check · tap to edit` : 'All details look good'}</span>
          </div>
        </div>

        <div className="tiles">
          <Tile label="Amount" value={f('total') ? money(f('total'), f('cur') || 'INR') : ''} editKey="amount" badgeKey="total" wide />
          <Tile label="Bill date" value={f('date') ? (toIsoDate(f('date')) ? fdate(toIsoDate(f('date'))) : f('date')) : ''} editKey="date" badgeKey="date" />
          <Tile label="Invoice no." value={f('no')} editKey="no" badgeKey="no" />
          <Tile label="Category" value={[extCat, extSub].filter(Boolean).join(' · ')} editKey="cat" wide />
          <Tile label="Name" value={user.name} wide />
        </div>

        <details className="rv-more">
          <summary>More details <span className="sm mut">Tax, payment, items, view</span></summary>
          <div className="tiles">
            <Tile label="Tax" value={f('tax') ? money(f('tax'), f('cur') || 'INR') : ''} editKey="tax" badgeKey="tax" />
            <Tile label="Payment" value={f('pay')} editKey="pay" badgeKey="pay" />
            <Tile label="View" value={`${extCont || 'None'} · ${extPers ? 'Personal' : 'Business'}`} editKey="view" wide />
            <Tile label="Items" value={f('items')} editKey="items" badgeKey="items" wide />
          </div>
        </details>

        <div className="rv-legend sm mut"><i className="dot ok" /> Found <i className="dot warn" /> Check <i className="dot err" /> Missing <i className="dot acc" /> Edited</div>

        <div className="actionbar">
          <button className="btn" onClick={() => void cancelReview()} disabled={savingBill}>{discarding ? 'Discarding…' : 'Cancel'}</button>
          <button className="btn p" onClick={confirmExt} disabled={savingBill}>{savingBill && !discarding ? 'Saving…' : 'Save bill'}</button>
        </div>
      </>
    );
  };

  /* ===================== MAIN RENDER ===================== */
  return (
    <>
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={handleFileChange} />
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />

      <div className="mock">Bill files are encrypted at rest. Review extracted details before saving.</div>
      <div className={`app${isAuth ? ' auth' : ''}`} style={{ gridTemplateColumns: isAuth ? '1fr' : undefined }}>
        {/* ===== SIDEBAR ===== */}
        {!isAuth && (
          <aside className="side">
            <div className="logo" aria-label="Travelogue">
              <AppMark />
            </div>
            <nav>
              {NAV_ITEMS.map(n => (
                <button key={n.id} className={`nav${navActive(n.id) ? ' on' : ''}`} onClick={() => show(n.id as Screen)}>
                  <span aria-hidden="true">{n.icon}</span>{n.label}
                </button>
              ))}
            </nav>
          </aside>
        )}

        {/* ===== MAIN ===== */}
        <main>
          {/* Top Header */}
          <header className={`top${screen === 'dash' ? ' top-dash' : ''}${!isAuth ? ' top-dark' : ''}`}>
            <div className="tl">
              {showBack && (
                <button className="back" onClick={goBack} aria-label="Go back">‹ Back</button>
              )}
              {!isAuth && screen === 'dash' ? (
                <div className="hello">
                  <i className="av">{user.initials}</i>
                  <b>{user.name}</b>
                </div>
              ) : (
                <div className="brand" aria-label="Travelogue">
                  <AppMark />
                </div>
              )}
            </div>
            <div className="tr">
              {isAuth ? (
                <button className="tbtn" onClick={toggleTheme} aria-label="Switch theme">
                  {theme === 'dark' ? <><span>☀</span><span className="tt"> Light mode</span></> : <><span>☾</span><span className="tt"> Dark mode</span></>}
                </button>
              ) : (
                <div className="profile-menu-wrap">
                  <button
                    type="button"
                    className="tbtn icon-btn burger"
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    aria-label="Menu"
                    onClick={() => setMoreOpen(open => !open)}
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                  {moreOpen && (
                    <>
                      <div className="menu-scrim" onClick={() => setMoreOpen(false)} />
                      <div className="profile-menu more-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => openPanel('prefs')}><span aria-hidden="true">⚙</span> Preferences</button>
                        <button type="button" role="menuitem" className="logout-btn" onClick={() => { setMoreOpen(false); logout(); }}>
                          <span aria-hidden="true">↪</span> Log Off
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </header>

          {/* ===== AUTH SCREEN ===== */}
          {screen === 'auth' && (
            <section id="s-auth">
              <div className="card">
                <div className="authlogo"><AppMark size={44} /></div>
                <h1>{isSignUp ? 'Create account' : 'Sign in'}</h1>
                <p className="mut">
                  {isSignUp
                    ? 'Tell us your name, then choose email or WhatsApp number for your one-time code.'
                    : 'Choose email or WhatsApp number for your one-time code.'}
                </p>
                {!otpSent ? (
                  <div>
                    {isSignUp && (
                      <>
                        <label htmlFor="nm">Full name</label>
                        <input type="text" id="nm" placeholder="e.g. Anika Kapoor" autoComplete="name" value={authName} onChange={e => setAuthName(e.target.value)} />
                        <div className="seg" role="group" aria-label="Sign up with">
                          <button type="button" className={signupMode === 'e' ? 'on' : ''} onClick={() => setSignupMode('e')}>Email</button>
                          <button type="button" className={signupMode === 'm' ? 'on' : ''} onClick={() => setSignupMode('m')}>WhatsApp</button>
                        </div>
                        <label htmlFor="cm">{signupMode === 'e' ? 'Email address' : 'WhatsApp number'}</label>
                        <input type="text" id="cm" inputMode={signupMode === 'e' ? 'email' : 'tel'} placeholder={signupMode === 'e' ? 'name@company.com' : '+91 9876543210'} autoComplete={signupMode === 'e' ? 'email' : 'tel'} value={authContact} onChange={e => setAuthContact(e.target.value)} />
                      </>
                    )}
                    {!isSignUp && (
                      <>
                        <div className="seg" role="group" aria-label="Send code by">
                          <button type="button" className={signupMode === 'e' ? 'on' : ''} onClick={() => setSignupMode('e')}>Email</button>
                          <button type="button" className={signupMode === 'm' ? 'on' : ''} onClick={() => setSignupMode('m')}>WhatsApp</button>
                        </div>
                        <label htmlFor="id">{signupMode === 'e' ? 'Email address' : 'WhatsApp number'}</label>
                        <input type="text" id="id" inputMode={signupMode === 'e' ? 'email' : 'tel'} placeholder={signupMode === 'e' ? 'name@company.com' : '+91 9876543210'} autoComplete={signupMode === 'e' ? 'email' : 'tel'} value={signInId} onChange={e => setSignInId(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendOtp()} />
                      </>
                    )}
                    <div className="acts">
                      <button className="btn p" onClick={sendOtp} disabled={authLoading}>{isSignUp ? 'Create account and send code' : 'Send code'}</button>
                      <button className="btn" onClick={toggleAuth}>{isSignUp ? 'I already have an account' : 'Create an account'}</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="sm mut">{otpNotice || <>Code sent to <b>{sentTo}</b>.</>}</p>
                    <label htmlFor="otp">6-digit code</label>
                    <input type="text" id="otp" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === 'Enter' && verify()} />
                    <div className="acts">
                      <button className="btn p" onClick={verify} disabled={authLoading}>Verify and continue</button>
                      <button className="btn" onClick={sendOtp}>Resend code</button>
                    </div>
                  </div>
                )}
                {authLoading && <div className="spin" style={{ marginTop: 12 }} />}
                {authMsg && <div className={`msg ${authMsgType}`}>{authMsg}</div>}
              </div>
            </section>
          )}

          {/* ===== DASHBOARD ===== */}
          {screen === 'dash' && (
            <section id="s-dash">
              <nav className="qnav" aria-label="Bill lists">
                {([['fav', 'star', 'Favorites'], ['recent', 'clock', 'Recent'], ['shared', 'share', 'Shared'], ['deleted', 'trash', 'Deleted']] as const).map(([id, ic, label]) => (
                  <button key={id} type="button" className={`qn${dashTab === id ? ' on' : ''}`} aria-pressed={dashTab === id}
                    onClick={() => { setDashTab(id); setQuickMore(false); if (id === 'deleted') void loadDeleted(); }}>
                    <QIcon name={ic} />{label}
                  </button>
                ))}
                <div className="qn-wrap">
                  <button type="button" className={`qn${quickMore ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={quickMore} onClick={() => setQuickMore(o => !o)}>
                    <QIcon name="more" />More
                  </button>
                  {quickMore && (
                    <>
                      <div className="menu-scrim" onClick={() => setQuickMore(false)} />
                      <div className="profile-menu more-menu qmenu" role="menu">
                        <button type="button" role="menuitem" onClick={() => openPanel('range')}><span aria-hidden="true">📅</span> Date Range</button>
                        <button type="button" role="menuitem" onClick={() => openPanel('reports')}><span aria-hidden="true">▥</span> Reports</button>
                      </div>
                    </>
                  )}
                </div>
              </nav>
              {(() => {
                const inRange = (b: any) => {
                  const d = String(b.date || '').slice(0, 10);
                  if (rangeFrom && (!d || d < rangeFrom)) return false;
                  if (rangeTo && (!d || d > rangeTo)) return false;
                  return true;
                };
                const active = bills.filter(b => b.st !== 'Processing');
                const title = { fav: 'Favorites', recent: 'Recent', shared: 'Shared', deleted: 'Deleted' }[dashTab];
                const sharedIn = incomingShared.flatMap((g: any) => g.bills.map((b: any) => ({ ...b, _in: true, _from: g.who?.name })));
                const list: any[] = (dashTab === 'fav' ? active.filter(b => favs.has(String(b.id)))
                  : dashTab === 'recent' ? (rangeFrom || rangeTo ? active : recentBills)
                  : dashTab === 'shared' ? [...active.filter(b => shRecips('b:' + b.id).length > 0), ...sharedIn]
                  : deletedBills).filter(inRange);
                const empty = { fav: 'No favorites yet. Tap ☆ next to a bill to add it here.', recent: 'No bills yet. Tap Scan Bill below to add your first bill.', shared: 'No shared bills yet. Tap the share icon on a bill to share it.', deleted: 'No deleted bills.' }[dashTab];
                return (
                  <>
                    <div className="dash-head">
                      <h2>{title}</h2>
                      {dashTab === 'recent' && bills.length > 0 && !rangeFrom && !rangeTo && <button className="btn lnk" onClick={() => show('bills')}>See all ({bills.length})</button>}
                    </div>
                    {(rangeFrom || rangeTo) && (
                      <div className="range-chip">
                        <span>📅 {rangeFrom ? fdate(rangeFrom) : 'Any'} – {rangeTo ? fdate(rangeTo) : 'Any'}</span>
                        <button type="button" onClick={() => { setRangeFrom(''); setRangeTo(''); }} aria-label="Clear date range">×</button>
                      </div>
                    )}
                    {dashTab === 'deleted' && deletedLoading ? <div className="spin" /> : !list.length ? (
                      <div className="card empty dash-empty"><p className="mut sm">{empty}</p></div>
                    ) : dashTab === 'deleted' ? (
                      <div className="list">
                        {list.map(b => (
                          <div key={b.id} className="drow">
                            <span className="g"><b>{b.m}</b><span className="sm mut">{fdate(b.date)} · {money(b.total, b.cur)}</span></span>
                            <button type="button" className="btn" onClick={() => void restoreBill(b)}>Restore</button>
                            <button type="button" className="btn danger" onClick={() => void deleteForever(b)} aria-label={`Delete bill from ${b.m} forever`}>Delete forever</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="list recent">
                        {list.map(b => {
                          const id = String(b.id);
                          const t = thumbs[id];
                          if (b._in) {
                            return (
                              <div key={'in' + id} className="rrow">
                                <span className="star" aria-hidden="true" />
                                <button type="button" className="rinfo" onClick={() => void openSharedBill(b)}>
                                  <span className="g"><b>{b.m}</b><span className="sm mut">Shared with you{b._from ? ' by ' + b._from : ''} · {fdate(b.date)}</span></span>
                                  <span className="amt">{money(b.total, b.cur)}</span>
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div key={id} className="rrow">
                              <button type="button" className={`star${favs.has(id) ? ' on' : ''}`} onClick={() => toggleFav(id)}
                                aria-pressed={favs.has(id)} aria-label={favs.has(id) ? 'Remove from favorites' : 'Add to favorites'}>
                                {favs.has(id) ? '★' : '☆'}
                              </button>
                              <button type="button" className="thumb" onClick={() => void openViewer(b)} aria-label={`View image of bill from ${b.m}`}>
                                {t && t !== 'pdf' && t !== 'error'
                                  ? <img src={t} alt="" />
                                  : <span aria-hidden="true">{t === 'pdf' ? 'PDF' : '▤'}</span>}
                              </button>
                              <button type="button" className="rinfo" onClick={() => openBillModal(b.id)}>
                                <span className="g">
                                  <b>{b.m}</b>
                                  <span className="sm mut">{fdate(b.date)}{b.cat ? ' · ' + b.cat : ''}</span>
                                </span>
                                <span className="amt">{money(b.total, b.cur)}</span>
                              </button>
                              <button type="button" className="ract" onClick={() => openShare('b', b.id)} aria-label={`Share bill from ${b.m}`} title="Share"><QIcon name="share" /></button>
                              <button type="button" className="ract del" onClick={() => deleteBill(b)} aria-label={`Delete bill from ${b.m}`} title="Delete"><QIcon name="trash" /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="scan-dock">
                <button className="btn p scanbig" onClick={goScan}>📷 Scan Bill</button>
              </div>
            </section>
          )}

          {/* ===== SCAN SCREEN: full-screen camera ===== */}
          {screen === 'scan' && (
            <section className="camview" id="s-scan" aria-label="Camera">
              <video ref={videoRef} playsInline muted autoPlay className={camActive ? 'on' : ''} />
              {camActive && <div className="camframe" aria-hidden="true"><span>Fit the whole bill inside the frame</span></div>}
              {!camActive && (
                <div className="camstate">
                  {camMsg === '<spin>' && <><div className="spin" /><p>Opening camera…</p></>}
                  {camMsg.startsWith('err:') && (
                    <>
                      <p>{camMsg.slice(4)}</p>
                      <button className="btn p" onClick={openNativeCam}>Use phone camera app</button>
                      <button className="btn" onClick={goLiveCam}>Try again</button>
                    </>
                  )}
                </div>
              )}
              <div className="cambar">
                <button type="button" className="camside" onClick={goUpload} aria-label="Choose from gallery">
                  <span aria-hidden="true">🖼</span><small>Gallery</small>
                </button>
                <button type="button" className="shutter" onClick={capture} disabled={!camActive} aria-label="Take photo" />
                <button type="button" className="camside" onClick={() => show('dash')} aria-label="Close camera">
                  <span aria-hidden="true">✕</span><small>Close</small>
                </button>
              </div>
            </section>
          )}

          {/* ===== PREVIEW SCREEN ===== */}
          {screen === 'prev' && (
            <section className="narrow" id="s-prev">
              <h1>Check the bill</h1>
              <p className="mut">Make sure the text is sharp and nothing is cut off.</p>
              <div className="card">
                {capturedImg && (capturedFile?.type === 'application/pdf'
                  ? <iframe className="pdf-preview" src={capturedImg} title="Selected bill PDF" />
                  : <img className="prev" src={capturedImg} alt="Captured bill" />)}
                {prevNote && <div className="msg info">{prevNote} Check that the amount and date are readable.</div>}
              </div>
              <div className="pbar">
                <button className="btn" onClick={goScan}>Rescan</button>
                <button className="btn" onClick={() => show('dash')}>Cancel</button>
                <button className="btn p" onClick={startExtract}>OK, continue</button>
              </div>
            </section>
          )}

          {/* ===== SAVE SCREEN ===== */}
          {screen === 'save' && (
            <section className="narrow" id="s-save">
              <h1>Save bill</h1>
              <p className="mut">Choose where this bill belongs.</p>
              <div className="card">
                <label htmlFor="sC">View</label>
                <select id="sC" value={saveCont} onChange={e => setSaveCont(e.target.value)}>
                  <option value="">Select a view</option>
                  {conts.map(c => <option key={c}>{c}</option>)}
                </select>
                <label htmlFor="sK">Category</label>
                <select id="sK" value={saveCat} onChange={e => fillSub(e.target.value)}>
                  <option value="">Select a category</option>
                  {Object.keys(cats).map(k => <option key={k}>{k}</option>)}
                </select>
                <label htmlFor="sS">Subcategory</label>
                <select id="sS" value={saveSub} onChange={e => setSaveSub(e.target.value)}>
                  {!saveCat
                    ? <option value="">Choose a category first</option>
                    : (cats[saveCat] || []).map(s => <option key={s}>{s}</option>)
                  }
                </select>
                <label className="chk">
                  <input type="checkbox" checked={savePers} onChange={e => setSavePers(e.target.checked)} />
                  Mark as personal expense
                </label>
                {saveMsg && <div className="msg err">{saveMsg}</div>}
                <div className="acts">
                  <button className="btn p" onClick={saveBill}>Save bill</button>
                  <button className="btn" onClick={() => show('prev')}>Back</button>
                </div>
              </div>
            </section>
          )}

          {/* ===== EXTRACTION SCREEN ===== */}
          {screen === 'ext' && (
            <section className="mid" id="s-ext">
              <h1>Review bill</h1>
              <div className={ocrDone && !invalidDocument && !(ocrError && !curBill) ? '' : 'card'} id="extBox">
                {ocrError && !curBill ? (
                  <>
                    <div className="msg err" role="alert">{ocrError}</div>
                    <div className="acts">
                      <button className="btn" onClick={() => show('prev')}>Back to bill</button>
                      <button className="btn" onClick={() => show('dash')}>Cancel</button>
                    </div>
                  </>
                ) : !ocrDone ? (
                  <>
                    <p className="mut">Recognizing text locally. The first document may take longer while the OCR engine starts.</p>
                    <div className="spin" />
                  </>
                ) : invalidDocument ? (
                  <>
                    {capturedFile?.type === 'application/pdf'
                      ? <iframe className="pdf-preview" src={capturedImg} title="Uploaded document preview" />
                      : <img className="prev" style={{ maxWidth: 200 }} src={capturedImg} alt="Uploaded document" />}
                    <div style={{ flex: '1 1 280px' }}>
                      <div className="msg err" role="alert">{ocrError}</div>
                      <div className="msg info">
                        Check that you selected the right file and that the bill text is sharp, well-lit, and readable. Non-English or unusual receipts may not be recognized by this English OCR.
                      </div>
                      <div className="acts">
                        <button className="btn p" onClick={() => show('prev')}>Choose another file</button>
                        <button className="btn" onClick={() => show('bills')}>Close</button>
                      </div>
                    </div>
                  </>
                ) : (
                  renderReview()
                )}
              </div>
            </section>
          )}

          {/* ===== MY BILLS ===== */}
          {screen === 'bills' && (
            <section id="s-bills">
              <h1>My bills</h1>
              <p className="mut" id="bSub">{filteredBills.length} of {bills.length} bills</p>
              <div className="filters">
                <input type="search" placeholder="Search merchant or bill number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search bills" style={{ gridColumn: '1 / -1' }} />
                {/* Multi-select views dropdown */}
                <div className="ms" id="fC">
                  <button type="button" className="msb" aria-haspopup="true" aria-expanded={msOpen ? 'true' : 'false'} onClick={() => setMsOpen(v => !v)}>
                    <span>{msLabel()}</span>
                    <span aria-hidden="true">▾</span>
                  </button>
                  <div className="msp" hidden={!msOpen}>
                    <div className="msa">
                      <button type="button" onClick={msSelectAll}>Select all</button>
                      <button type="button" onClick={msClear}>Clear</button>
                    </div>
                    {conts.map(c => (
                      <label key={c} className="mso">
                        <input type="checkbox" value={c} checked={selViews.has(c)} onChange={e => msToggle(c, e.target.checked)} />
                        <span>{c}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {/* Category filter */}
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)} aria-label="Category">
                  <option value="">All categories</option>
                  {Object.keys(cats).map(k => <option key={k}>{k}</option>)}
                </select>
                {/* Date filter */}
                <select value={filterDate} onChange={e => { setFilterDate(e.target.value); if (e.target.value !== 'custom') { setFilterFrom(''); setFilterTo(''); } }} aria-label="Date">
                  <option value="">Any date</option>
                  <option value="30">Last 30 days</option>
                  <option value="prev">Previous month</option>
                  <option value="custom">Custom range</option>
                </select>
                {filterDate === 'custom' && (
                  <div className="custom-date-row">
                    <div>
                      <label htmlFor="dF">From</label>
                      <input type="date" id="dF" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="dT">To</label>
                      <input type="date" id="dT" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
              <div className="mobile-filter-bar" aria-label="Bill filters">
                <input type="search" placeholder="Search merchant or bill number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search bills" />
                <div className="mobile-filter-buttons">
                  <button type="button" className="mobile-filter-trigger" aria-haspopup="dialog" aria-expanded={mobileFilter === 'views'} onClick={() => setMobileFilter('views')}>
                    <span>{msLabel()}</span><span aria-hidden="true">▾</span>
                  </button>
                  <button type="button" className="mobile-filter-trigger" aria-haspopup="dialog" aria-expanded={mobileFilter === 'category'} onClick={() => setMobileFilter('category')}>
                    <span>{filterCat || 'All categories'}</span><span aria-hidden="true">▾</span>
                  </button>
                  <button type="button" className="mobile-filter-trigger" aria-haspopup="dialog" aria-expanded={mobileFilter === 'date'} onClick={() => setMobileFilter('date')}>
                    <span>{filterDate === '30' ? 'Last 30 days' : filterDate === 'prev' ? 'Previous month' : filterDate === 'custom' ? 'Custom range' : 'Any date'}</span>
                    <span aria-hidden="true">▾</span>
                  </button>
                </div>
                {(q || filterCat || filterDate || selViews.size > 0) && (
                  <button type="button" className="mobile-clear-filters" onClick={clearFilters}>Clear filters</button>
                )}
              </div>
              <div className="list" id="bList">
                {billsLoading ? (
                  <div className="spin" />
                ) : !bills.length ? (
                  <div className="empty">
                    No bills yet.
                    <div className="acts" style={{ justifyContent: 'center' }}>
                      <button className="btn p" onClick={goScan}>Scan your first bill</button>
                    </div>
                  </div>
                ) : !filteredBills.length ? (
                  <div className="empty">
                    No bills match these filters.
                    <div className="acts" style={{ justifyContent: 'center' }}>
                      <button className="btn" onClick={clearFilters}>Clear filters</button>
                    </div>
                  </div>
                ) : (
                  filteredBills.map(b => <BillItem key={b.id} b={b} />)
                )}
              </div>
            </section>
          )}

          {/* ===== VIEWS SCREEN ===== */}
          {screen === 'cont' && (
            <section id="s-cont">
              <h1>My views</h1>
              <p className="mut">Group bills by trip, client, project or month.</p>
              <div className="card">
                <label htmlFor="nC">New view</label>
                <div className="row">
                  <input type="text" id="nC" placeholder="e.g. Bengaluru Conference" value={newContName} onChange={e => { setNewContName(e.target.value); setContMsg(''); }} onKeyDown={e => e.key === 'Enter' && addView()} />
                  <button className="btn p" style={{ flex: '0 0 auto' }} onClick={addView}>Create</button>
                </div>
                {contMsg && <div className="msg err">{contMsg}</div>}
              </div>
              <div className="list" id="cList" style={{ marginTop: 14 }}>
                {conts.map(c => {
                  const n = bills.filter(b => b.cont === c).length;
                  const sc = (shares['v:' + c] || []).filter(share => share.end !== 'Expired').length;
                  return (
                    <div key={c} className="vw">
                      <div className="ir">
                        <button className="item" onClick={() => goBills('view', c)}>
                          <span className="g">
                            <b>{c}</b>
                            <span className="sm mut">
                              {n ? n + ' bill' + (n > 1 ? 's' : '') : 'No bills yet. Save a bill here to see it.'}
                              {sc ? ' · Shared with ' + sc : ''}
                            </span>
                          </span>
                          <span className="pill">{n}</span>
                        </button>
                      </div>
                      <div className="vseg" role="group" aria-label={`Actions for ${c}`}>
                        <button onClick={() => openAddBills(c)}>Add bills</button>
                        <button onClick={() => openShare('v', c)}>Share</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ===== CATEGORIES SCREEN ===== */}
          {screen === 'cats' && (
            <section id="s-cats">
              <h1>Categories</h1>
              <p className="mut">Select a category to see its bills.</p>
              <div className="card">
                <label htmlFor="nK">New category</label>
                <div className="row">
                  <input type="text" id="nK" placeholder="e.g. Client Gifts" value={newCatName} onChange={e => { setNewCatName(e.target.value); setCatMsg(''); }} onKeyDown={e => e.key === 'Enter' && addCat()} />
                  <button className="btn p" style={{ flex: '0 0 auto' }} onClick={addCat}>Add</button>
                </div>
                {catMsg && <div className="msg err">{catMsg}</div>}
              </div>
              <div className="list" id="kList" style={{ marginTop: 14 }}>
                {Object.entries(cats).map(([k, subs]) => {
                  const n = bills.filter(b => b.cat === k).length;
                  return (
                    <button key={k} className="item" onClick={() => goBills('cat', k)} style={{ alignItems: 'flex-start' }}>
                      <span className="g">
                        <b>{k}</b>
                        <span className="chips">{subs.map(s => <span key={s} className="pill">{s}</span>)}</span>
                      </span>
                      <span className="pill acc">{n} bill{n === 1 ? '' : 's'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ===== SHARED SCREEN ===== */}
          {screen === 'shared' && (
            <section className="mid" id="s-shared">
              <h1>Shared</h1>
              <p className="mut">Bills shared with you and bills you have shared.</p>
              <div className="seg" id="shSeg">
                <button className={sharedTab === 'me' ? 'on' : ''} aria-pressed={sharedTab === 'me'} onClick={() => { setSharedTab('me'); setSharedView(null); }}>
                  Shared with me ({incomingShared.length})
                </button>
                <button className={sharedTab === 'by' ? 'on' : ''} aria-pressed={sharedTab === 'by'} onClick={() => { setSharedTab('by'); setSharedView(null); }}>
                  Shared by me ({byMe().length})
                </button>
              </div>
              <div id="shBody" style={{ marginTop: 14 }}>
                {sharedTab === 'me' && (
                  <>
                    {sharedView === null && (
                      <>
                        <div className="list" style={{ marginTop: 0 }}>
                          {incomingShared.length ? incomingShared.map((g, i) => (
                            <button key={i} className="item" onClick={() => setSharedView(i)}>
                              <span className="g">
                                <b>{g.name}</b>
                                <span className="sm mut">Shared by <strong>{g.by.name}</strong></span>
                              </span>
                              <span className="mut">{g.bills.length} bill{g.bills.length === 1 ? '' : 's'} ›</span>
                            </button>
                          )) : <div className="empty">No one has shared a bill with you yet.</div>}
                        </div>
                        <button className="btn p" style={{ width: '100%', marginTop: 14 }} onClick={() => setSharedView('all')}>
                          All shared bills, by person and type
                        </button>
                      </>
                    )}
                    {sharedView === 'all' && (
                      <>
                        <button className="btn" onClick={() => setSharedView(null)}>‹ All shared with me</button>
                        <h2 style={{ margin: '16px 0 0' }}>All shared bills, by person and type</h2>
                        {(() => {
                          const m: Record<string, { who: { name: string; email: string }; bills: any[] }> = {};
                          incomingShared.forEach(g => {
                            const e = m[g.by.email] = m[g.by.email] || { who: g.by, bills: [] };
                            e.bills.push(...g.bills);
                          });
                          return Object.values(m).map((entry, i) => <GroupCard key={i} entry={entry} own={false} />);
                        })()}
                      </>
                    )}
                    {typeof sharedView === 'number' && (
                      <>
                        <button className="btn" onClick={() => setSharedView(null)}>‹ All shared with me</button>
                        <h2 style={{ margin: '16px 0 2px' }}>{incomingShared[sharedView].name}</h2>
                        <p className="mut sm">Shared by <strong>{incomingShared[sharedView].by.name}</strong> · {incomingShared[sharedView].by.email}</p>
                        <div className="card" style={{ padding: '8px 16px' }}>
                          {incomingShared[sharedView].bills.map((b: any) => <RowBill key={b.id} b={b} own={false} />)}
                        </div>
                      </>
                    )}
                  </>
                )}
                {sharedTab === 'by' && (
                  <>
                    {byMe().length ? (
                      <>
                        <p className="mut sm" style={{ marginTop: 0 }}>People you have shared bills with, and the bill categories each person can see.</p>
                        {byMe().map((entry, i) => <GroupCard key={i} entry={entry} own={true} />)}
                      </>
                    ) : (
                      <div className="empty">
                        You have not shared any bills yet.
                        <div className="acts" style={{ justifyContent: 'center' }}>
                          <button className="btn p" onClick={() => show('bills')}>Go to My bills</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* ===== BOTTOM NAV (mobile) ===== */}
      {!isAuth && screen !== 'scan' && screen !== 'ext' && (
        <nav className="bnav" id="nav2">
          {NAV_ITEMS.map(n => (
            <button key={n.id} className={`nav${navActive(n.id) ? ' on' : ''}`} onClick={() => show(n.id as Screen)}>
              <span aria-hidden="true">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
      )}

      {/* ===== SHEETS: scan choice, favourites, deleted, reports ===== */}
      {panel !== 'none' && (
        <div className="sheet-backdrop" onClick={e => { if (e.target === e.currentTarget) setPanel('none'); }}>
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <h2 id="sheet-title">
                {panel === 'scan' ? 'Add a bill' : panel === 'fav' ? 'Favourite bills' : panel === 'deleted' ? 'Deleted bills' : panel === 'prefs' ? 'Preferences' : panel === 'range' ? 'Date range' : 'Reports'}
              </h2>
              <button type="button" className="x" onClick={() => setPanel('none')} aria-label="Close">×</button>
            </div>

            {panel === 'scan' && (
              <div className="choice-list">
                <button type="button" className="choice" onClick={openCam}>
                  <span className="ci" aria-hidden="true">📷</span>
                  <span className="g"><b>Take a photo</b><span className="sm mut">Opens the camera. Capture the bill, then check the photo.</span></span>
                </button>
                <button type="button" className="choice" onClick={goUpload}>
                  <span className="ci" aria-hidden="true">🖼</span>
                  <span className="g"><b>Choose from gallery or files</b><span className="sm mut">A photo you already took, a screenshot, or a PDF invoice (max 10 MB).</span></span>
                </button>
              </div>
            )}

            {panel === 'fav' && (() => {
              const list = bills.filter(b => favs.has(String(b.id)));
              return list.length ? (
                <div className="list recent">
                  {list.map(b => {
                    const id = String(b.id); const t = thumbs[id];
                    return (
                      <div key={id} className="rrow">
                        <button type="button" className="thumb" onClick={() => void openViewer(b)} aria-label={`View image of bill from ${b.m}`}>
                          {t && t !== 'pdf' && t !== 'error' ? <img src={t} alt="" /> : <span aria-hidden="true">{t === 'pdf' ? 'PDF' : '▤'}</span>}
                        </button>
                        <button type="button" className="rinfo" onClick={() => { setPanel('none'); void openBillModal(b.id); }}>
                          <span className="g"><b>{b.m}</b><span className="sm mut">{fdate(b.date)}</span></span>
                          <span className="amt">{money(b.total, b.cur)}</span>
                        </button>
                        <button type="button" className="star on" onClick={() => toggleFav(id)} aria-label="Remove from favourites">★</button>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="mut">No favourites yet. Tap ☆ next to a bill to add it here.</p>;
            })()}

            {panel === 'prefs' && (
              <div className="choice-list">
                <button type="button" className="choice" onClick={toggleTheme}>
                  <span className="ci" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
                  <span className="g"><b>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b><span className="sm mut">Currently using {theme} mode.</span></span>
                </button>
              </div>
            )}

            {panel === 'range' && (
              <div className="range-form">
                <label htmlFor="rg_from">From</label>
                <input id="rg_from" type="date" value={rangeFrom} max={rangeTo || undefined} onChange={e => setRangeFrom(e.target.value)} />
                <label htmlFor="rg_to">To</label>
                <input id="rg_to" type="date" value={rangeTo} min={rangeFrom || undefined} onChange={e => setRangeTo(e.target.value)} />
                <div className="acts">
                  <button type="button" className="btn p" onClick={() => setPanel('none')}>Apply</button>
                  <button type="button" className="btn" onClick={() => { setRangeFrom(''); setRangeTo(''); }}>Clear</button>
                </div>
                <p className="sm mut">Filters the bill list by the date printed on each bill.</p>
              </div>
            )}

            {panel === 'deleted' && (
              deletedLoading ? <div className="spin" /> : deletedBills.length ? (
                <div className="list">
                  <p className="sm mut" style={{ margin: 0 }}>Deleted bills are hidden from My bills and from people you shared them with. Restore one to bring it back.</p>
                  {deletedBills.map(b => (
                    <div key={b.id} className="drow">
                      <span className="g"><b>{b.m}</b><span className="sm mut">{fdate(b.date)} · {money(b.total, b.cur)}</span></span>
                      <button type="button" className="btn" onClick={() => void restoreBill(b)}>Restore</button>
                      <button type="button" className="btn danger" onClick={() => void deleteForever(b)} aria-label={`Delete bill from ${b.m} forever`}>Delete forever</button>
                    </div>
                  ))}
                </div>
              ) : <p className="mut">No deleted bills.</p>
            )}

            {panel === 'reports' && (() => {
              const real = bills.filter(b => b.st !== 'Processing' && b.st !== 'Not a bill');
              const sum = (list: any[]) => list.reduce((a, b) => a + (parseFloat(b.total) || 0), 0);
              const ym = (d: Date) => d.toISOString().slice(0, 7);
              const thisMonth = real.filter(b => (b.date || '').startsWith(ym(NOW)));
              const byCat: Record<string, any[]> = {};
              real.forEach(b => { (byCat[b.cat || 'Uncategorised'] = byCat[b.cat || 'Uncategorised'] || []).push(b); });
              const months = Array.from({ length: 6 }, (_, i) => new Date(NOW.getFullYear(), NOW.getMonth() - 5 + i, 15));
              const monthTotals = months.map(m => sum(real.filter(b => (b.date || '').startsWith(ym(m)))));
              const maxMonth = Math.max(1, ...monthTotals);
              const cats2 = Object.entries(byCat).sort((a, b) => sum(b[1]) - sum(a[1]));
              const cur = real[0]?.cur || 'INR';
              return (
                <div className="report">
                  <div className="kpis">
                    <div className="kpi"><span className="sm mut">This month</span><b>{money(String(sum(thisMonth)), cur)}</b><span className="sm mut">{thisMonth.length} bill{thisMonth.length === 1 ? '' : 's'}</span></div>
                    <div className="kpi"><span className="sm mut">All bills</span><b>{money(String(sum(real)), cur)}</b><span className="sm mut">{real.length} bill{real.length === 1 ? '' : 's'}</span></div>
                    <div className="kpi"><span className="sm mut">Personal</span><b>{money(String(sum(real.filter(b => b.pers))), cur)}</b><span className="sm mut">Business {money(String(sum(real.filter(b => !b.pers))), cur)}</span></div>
                  </div>
                  <h3>Last 6 months</h3>
                  <div className="bars">
                    {months.map((m, i) => (
                      <div key={i} className="bar" title={money(String(monthTotals[i]), cur)}>
                        <span className="fill" style={{ height: `${Math.round((monthTotals[i] / maxMonth) * 100)}%` }} />
                        <span className="sm mut">{m.toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </div>
                    ))}
                  </div>
                  <h3>By category</h3>
                  {cats2.length ? cats2.map(([c, list]) => (
                    <div key={c} className="crow">
                      <span className="g"><b>{c}</b><span className="sm mut">{list.length} bill{list.length === 1 ? '' : 's'}</span></span>
                      <span className="amt">{money(String(sum(list)), cur)}</span>
                    </div>
                  )) : <p className="mut">No bills yet.</p>}
                  <p className="sm mut">Totals use the date printed on each bill. Bills in other currencies are added as-is.</p>
                </div>
              );
            })()}
          </section>
        </div>
      )}

      {confirmDel && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <dialog open className="edit-pop confirm-pop" role="alertdialog" aria-labelledby="cd_t" onClick={e => e.stopPropagation()}>
            <h2 id="cd_t">Are you sure?</h2>
            <div className="acts">
              <button type="button" className="btn danger" onClick={() => void confirmDeleteBill()}>Confirm Delete</button>
              <button type="button" className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
            </div>
          </dialog>
        </div>
      )}

      {/* ===== EDIT POPUP (review screen) ===== */}
      {editKey && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setEditKey(null); }}>
          <dialog open className="edit-pop" onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setEditKey(null)} aria-label="Close">×</button>
            <h2>{({ date: 'Bill date', amount: 'Amount', no: 'Invoice number', m: 'Business name', tax: 'Tax', pay: 'Payment details', items: 'Items', cat: 'Category', view: 'View and type' } as Record<string, string>)[editKey]}</h2>
            {editKey === 'date' && (
              <>
                <label htmlFor="ed_date">Date on the bill</label>
                <input id="ed_date" type="date" value={editDraft.date || ''} max={new Date().toISOString().slice(0, 10)} onChange={e => setEditDraft({ date: e.target.value })} />
              </>
            )}
            {editKey === 'amount' && (
              <>
                <label htmlFor="ed_total">Total amount</label>
                <input id="ed_total" type="text" inputMode="decimal" value={editDraft.total || ''} placeholder="0.00" onChange={e => setEditDraft(d => ({ ...d, total: e.target.value.replace(/[^0-9.]/g, '') }))} />
                <label htmlFor="ed_cur">Currency</label>
                <select id="ed_cur" value={editDraft.cur || 'INR'} onChange={e => setEditDraft(d => ({ ...d, cur: e.target.value }))}>
                  {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map(c => <option key={c}>{c}</option>)}
                </select>
              </>
            )}
            {editKey === 'tax' && (
              <>
                <label htmlFor="ed_tax">Total tax (GST etc.)</label>
                <input id="ed_tax" type="text" inputMode="decimal" value={editDraft.tax || ''} placeholder="0.00" onChange={e => setEditDraft({ tax: e.target.value.replace(/[^0-9.]/g, '') })} />
              </>
            )}
            {(editKey === 'no' || editKey === 'm' || editKey === 'pay') && (
              <>
                <label htmlFor="ed_txt">{editKey === 'no' ? 'Invoice / bill number' : editKey === 'm' ? 'Business name' : 'Payment method'}</label>
                <input id="ed_txt" type="text" value={editDraft[editKey] || ''} onChange={e => setEditDraft({ [editKey]: e.target.value })} autoFocus />
              </>
            )}
            {editKey === 'items' && (
              <>
                <label htmlFor="ed_items">Items (one per line)</label>
                <textarea id="ed_items" rows={6} value={editDraft.items || ''} onChange={e => setEditDraft({ items: e.target.value })} />
              </>
            )}
            {editKey === 'cat' && (
              <>
                <label htmlFor="ed_cat">Category</label>
                <select id="ed_cat" value={editDraft.cat || ''} onChange={e => setEditDraft({ cat: e.target.value, sub: cats[e.target.value]?.[0] || '' })}>
                  <option value="">Choose a category</option>
                  {Object.keys(cats).map(k => <option key={k}>{k}</option>)}
                </select>
                <label htmlFor="ed_sub">Subcategory</label>
                <select id="ed_sub" value={editDraft.sub || ''} onChange={e => setEditDraft(d => ({ ...d, sub: e.target.value }))}>
                  {(cats[editDraft.cat] || []).map(x => <option key={x}>{x}</option>)}
                </select>
              </>
            )}
            {editKey === 'view' && (
              <>
                <label htmlFor="ed_view">View</label>
                <select id="ed_view" value={editDraft.view || ''} onChange={e => setEditDraft(d => ({ ...d, view: e.target.value }))}>
                  {conts.map(c => <option key={c}>{c}</option>)}
                </select>
                <div className="seg" role="group" aria-label="Expense type" style={{ marginTop: 14 }}>
                  <button type="button" className={editDraft.pers !== 'personal' ? 'on' : ''} onClick={() => setEditDraft(d => ({ ...d, pers: 'business' }))}>Business</button>
                  <button type="button" className={editDraft.pers === 'personal' ? 'on' : ''} onClick={() => setEditDraft(d => ({ ...d, pers: 'personal' }))}>Personal</button>
                </div>
              </>
            )}
            <div className="acts">
              <button className="btn p" onClick={saveEdit}>Save</button>
              <button className="btn" onClick={() => setEditKey(null)}>Cancel</button>
            </div>
          </dialog>
        </div>
      )}

      {/* ===== IMAGE VIEWER ===== */}
      {viewer && (
        <div className="modal-backdrop viewer" onClick={closeViewer}>
          <button className="x" onClick={closeViewer} aria-label="Close image">×</button>
          {viewer.pdf
            ? <iframe className="pdf-preview" src={viewer.url} title={viewer.title} onClick={e => e.stopPropagation()} />
            : <img src={viewer.url} alt={`Bill: ${viewer.title}`} onClick={e => e.stopPropagation()} />}
        </div>
      )}

      {mobileFilter && screen === 'bills' && (
        <div className="mobile-filter-backdrop" onClick={e => { if (e.target === e.currentTarget) setMobileFilter(null); }}>
          <section className="mobile-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-filter-title">
            <div className="mobile-filter-heading">
              <h2 id="mobile-filter-title">
                {mobileFilter === 'views' ? 'Filter by views' : mobileFilter === 'category' ? 'Filter by category' : 'Filter by date'}
              </h2>
              <button type="button" className="x" onClick={() => setMobileFilter(null)} aria-label="Close filters">×</button>
            </div>
            {mobileFilter === 'views' && (
              <>
                <div className="msa mobile-view-actions">
                  <button type="button" onClick={msSelectAll}>Select all</button>
                  <button type="button" onClick={msClear}>Clear</button>
                </div>
                <div className="mobile-filter-options">
                  {conts.map(c => (
                    <label key={c} className="mso">
                      <input type="checkbox" value={c} checked={selViews.has(c)} onChange={e => msToggle(c, e.target.checked)} />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {mobileFilter === 'category' && (
              <div className="mobile-filter-options">
                {['', ...Object.keys(cats)].map(category => (
                  <button type="button" key={category || 'all'} className="mobile-filter-option" aria-pressed={filterCat === category} onClick={() => { setFilterCat(category); setMobileFilter(null); }}>
                    <span>{category || 'All categories'}</span>{filterCat === category && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
            {mobileFilter === 'date' && (
              <>
                <div className="mobile-filter-options">
                  {[
                    ['', 'Any date'],
                    ['30', 'Last 30 days'],
                    ['prev', 'Previous month'],
                    ['custom', 'Custom range'],
                  ].map(([value, label]) => (
                    <button type="button" key={value || 'any'} className="mobile-filter-option" aria-pressed={filterDate === value} onClick={() => {
                      setFilterDate(value);
                      if (value !== 'custom') {
                        setFilterFrom('');
                        setFilterTo('');
                        setMobileFilter(null);
                      }
                    }}>
                      <span>{label}</span>{filterDate === value && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
                {filterDate === 'custom' && (
                  <div className="custom-date-row mobile-custom-date-row">
                    <div>
                      <label htmlFor="mobile-date-from">From</label>
                      <input type="date" id="mobile-date-from" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="mobile-date-to">To</label>
                      <input type="date" id="mobile-date-to" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="mobile-filter-footer">
              {mobileFilter === 'views' && <button type="button" className="btn" onClick={msClear}>Clear selection</button>}
              <button type="button" className="btn p" onClick={() => setMobileFilter(null)}>
                {mobileFilter === 'views' ? 'Apply views' : mobileFilter === 'date' && filterDate === 'custom' ? 'Apply date range' : 'Done'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ===== TOAST ===== */}
      <div className={`toast${toastMsg ? ' on' : ''}`} role="status">{toastMsg}</div>

      {/* ===== MODALS ===== */}

      {/* Bill Detail Modal */}
      {modal === 'billDetail' && modalBill && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <dialog open onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setModal('none')} aria-label="Close">×</button>
            <h2>{modalBill.m}</h2>
            {billFileStatus === 'loading'
              ? <p className="mut" role="status">Loading bill file…</p>
              : billFileStatus === 'error'
                ? <div className="msg err" role="alert">The original bill file could not be loaded.</div>
                : modalBill.mimeType === 'application/pdf'
                  ? <iframe className="pdf-preview" src={modalBill.img} title="Bill PDF" />
                  : <img className="prev" src={modalBill.img} alt="Bill image" />}
            <dl>
              <dt>Date</dt><dd>{fdate(modalBill.date)}</dd>
              <dt>Bill number</dt><dd>{modalBill.no || 'Not available'}</dd>
              <dt>Total</dt><dd>{money(modalBill.total, modalBill.cur)}</dd>
              <dt>Tax</dt><dd>{money(modalBill.tax, modalBill.cur)}</dd>
              <dt>Items</dt><dd style={{ whiteSpace: 'pre-line' }}>{modalBill.items || 'Not available'}</dd>
              <dt>Payment</dt><dd>{modalBill.pay || 'Not available'}</dd>
              <dt>View</dt><dd>{modalBill.cont}</dd>
              <dt>Category</dt><dd>{modalBill.cat} / {modalBill.sub}</dd>
              <dt>Type</dt><dd>{modalBill.pers ? 'Personal' : 'Business'}</dd>
              <dt>Status</dt><dd>{modalBill.st}</dd>
            </dl>
            <label htmlFor="mv">Move to view</label>
            <div className="row">
              <select id="mv" value={modalMoveTo} onChange={e => setModalMoveTo(e.target.value)}>
                {conts.map(c => <option key={c}>{c}</option>)}
              </select>
              <button className="btn" style={{ flex: '0 0 auto' }} onClick={moveBill}>Move</button>
            </div>
            <div className="acts">
              <button className="btn p ic" onClick={() => { setModal('none'); openShare('b', modalBill.id); }}><ShareIcon />Share</button>
              <button className="btn" onClick={() => toggleFav(String(modalBill.id))}>
                {favs.has(String(modalBill.id)) ? '★ Favourite' : '☆ Add to favourites'}
              </button>
              <button className="btn danger" onClick={() => void deleteBill(modalBill)}>Delete</button>
              <button className="btn" onClick={() => setModal('none')}>Close</button>
            </div>
          </dialog>
        </div>
      )}

      {/* Add Bills to View Modal */}
      {modal === 'addBills' && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <dialog open onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setModal('none')} aria-label="Close">×</button>
            <h2>Add bills to {addBillsTo}</h2>
            <p className="mut sm">Select the bills to move into this view. Each bill belongs to one view, so it leaves its current one.</p>
            {(() => {
              const avail = bills.filter(b => b.cont !== addBillsTo && b.st !== 'Processing');
              return avail.length ? (
                <div className="pick">
                  {avail.map(b => (
                    <label key={b.id} className="pk">
                      <input type="checkbox" className="pick-cb" value={b.id} />
                      <span className="g"><b>{b.m}</b><span className="sm mut">{fdate(b.date)} · {b.cont}</span></span>
                      <span className="amt">{money(b.total, b.cur)}</span>
                    </label>
                  ))}
                </div>
              ) : <p className="mut">All your bills are already in this view.</p>;
            })()}
            {pkMsg && <div className="msg err">{pkMsg}</div>}
            <div className="acts">
              {bills.filter(b => b.cont !== addBillsTo && b.st !== 'Processing').length > 0 && (
                <button className="btn p" onClick={confirmAddBills}>Add to view</button>
              )}
              <button className="btn" onClick={() => setModal('none')}>
                {bills.filter(b => b.cont !== addBillsTo && b.st !== 'Processing').length > 0 ? 'Skip for now' : 'Close'}
              </button>
            </div>
          </dialog>
        </div>
      )}

      {/* Share Modal */}
      {modal === 'share' && (
        <div className="share-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
            <button className="x" onClick={() => setModal('none')} aria-label="Close">×</button>
            <h2 id="share-dialog-title">{shareTitle}</h2>
            <p className="mut sm" style={{ marginBottom: 10 }}>{shareSub}</p>
            <p style={{ margin: '0 0 4px' }}>
              <span className="pill acc cnt2">
                <ShareIcon />
                {sharedWith.length ? 'Shared with ' + sharedWith.length + (sharedWith.length === 1 ? ' person' : ' people') : 'Not shared yet'}
              </span>
            </p>
            <label htmlFor="share-person">Share with</label>
            <select
              id="share-person"
              value={shareRecipientSelection}
              onChange={e => {
                const value = e.target.value;
                setShareRecipientSelection(value);
                if (value === '__new__' || !value) {
                  setShareNewVal('');
                  setShareNewMode('e');
                } else {
                  setShareNewVal(value);
                  setShareNewMode(value.includes('@') ? 'e' : 'm');
                }
                setShareMsg('');
              }}
            >
              <option value="">Select a person</option>
              {knownShareContacts.map(contact => <option key={contact} value={contact}>{contact}</option>)}
              <option value="__new__">+ Add someone new</option>
            </select>
            {shareRecipientSelection === '__new__' && (
              <>
                <div className="seg" role="group" aria-label="New recipient type">
                  <button type="button" className={shareNewMode === 'e' ? 'on' : ''} onClick={() => setShareNewMode('e')}>Email</button>
                  <button type="button" className={shareNewMode === 'm' ? 'on' : ''} onClick={() => setShareNewMode('m')}>WhatsApp</button>
                </div>
                <label htmlFor="share-recipient">{shareNewMode === 'e' ? 'Recipient email address' : 'Recipient WhatsApp number'}</label>
                <input id="share-recipient" type="text" inputMode={shareNewMode === 'e' ? 'email' : 'tel'} placeholder={shareNewMode === 'e' ? 'name@company.com' : '+91 9876543210'} value={shareNewVal} onChange={e => setShareNewVal(e.target.value)} />
              </>
            )}
            {shareMsg && <div className={`msg ${shareMsg.startsWith('Shared') ? 'info' : 'err'}`}>{shareMsg}</div>}
            <label htmlFor="she">Access ends</label>
            <select id="she" value={shareExpiry} onChange={e => setShareExpiry(e.target.value)}>
              {EXPIRY_OPTS.map(o => <option key={o}>{o}</option>)}
            </select>
            <p className="mut sm" style={{ margin: '12px 0 0' }}>
              The recipient must sign in with this exact contact. No email or WhatsApp notification is sent yet. They can view and download only, not edit or delete.{shareType === 'v' ? ' All bills in this view are included.' : ''}
            </p>
            <div className="acts">
              <button className="btn p ic" onClick={doShare}><ShareIcon />Share</button>
              <button className="btn" onClick={() => setModal('none')}>Close</button>
            </div>
            <h2 style={{ marginTop: 22 }}>Shared with ({sharedWith.length})</h2>
            <div>
              {sharedWith.length ? sharedWith.map((x: any) => {
                const c = cOf(x.to);
                return (
                  <div key={x.to} className="shrow">
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                      <i className="av">{ini(c.name)}</i>
                      <span style={{ minWidth: 0 }}>
                        <b>{c.name}</b>
                        <span className="sm mut" style={{ overflowWrap: 'anywhere' }}>
                          {c.email !== c.name ? c.email + ' · ' : ''}View only · {x.end}{x.via ? ' · via view ' + x.via : ''}
                        </span>
                      </span>
                    </span>
                    {!x.via && x.id && <button className="btn" onClick={() => void unshare(x.id)}>Remove</button>}
                  </div>
                );
              }) : <p className="mut sm">Not shared with anyone yet.</p>}
            </div>
          </section>
        </div>
      )}

      {/* Shared Bill Detail Modal (view-only) */}
      {modal === 'sharedBill' && sharedViewBill && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <dialog open onClick={e => e.stopPropagation()}>
            <button className="x" onClick={() => setModal('none')} aria-label="Close">×</button>
            <h2>{sharedViewBill.m}</h2>
            {billFileStatus === 'loading'
              ? <p className="mut" role="status">Loading bill file…</p>
              : billFileStatus === 'error'
                ? <div className="msg err" role="alert">The original bill file could not be loaded.</div>
                : sharedViewBill.mimeType === 'application/pdf'
                  ? <iframe className="pdf-preview" src={sharedViewBill.img} title="Shared bill PDF" />
                  : <img className="prev" src={sharedViewBill.img} alt="Bill image" />}
            <dl>
              <dt>Date</dt><dd>{fdate(sharedViewBill.date)}</dd>
              <dt>Bill number</dt><dd>{sharedViewBill.no || 'Not available'}</dd>
              <dt>Total</dt><dd>{money(sharedViewBill.total, sharedViewBill.cur)}</dd>
              <dt>Tax</dt><dd>{money(sharedViewBill.tax, sharedViewBill.cur)}</dd>
              <dt>Items</dt><dd style={{ whiteSpace: 'pre-line' }}>{sharedViewBill.items || 'Not available'}</dd>
              <dt>Payment</dt><dd>{sharedViewBill.pay || 'Not available'}</dd>
              <dt>Category</dt><dd>{sharedViewBill.cat} / {sharedViewBill.sub}</dd>
              {sharedViewBill.by && <><dt>Shared by</dt><dd>{sharedViewBill.by}</dd></>}
              {sharedViewBill.grp && <><dt>View</dt><dd>{sharedViewBill.grp}</dd></>}
            </dl>
            <p className="mut sm">You can view and download only.</p>
            <div className="acts">
              <button className="btn p" onClick={() => void downloadBill(sharedViewBill)}>Download</button>
              <button className="btn" onClick={() => setModal('none')}>Close</button>
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}
