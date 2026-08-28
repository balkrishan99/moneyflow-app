import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Wallet, LogOut, Plus, Trash2, Edit2, TrendingUp, TrendingDown, ArrowRightLeft,
  Users, Receipt, ArrowRight, Repeat, Target, Sparkles, Loader2, Check, Bell,
  Search, Filter, Settings as SettingsIcon, LayoutDashboard, List, PiggyBank,
  BarChart3, X, AlertTriangle, Download, Upload, History, ChevronDown, CreditCard,
  Landmark, Banknote, HandCoins, RefreshCw, Info,
} from "lucide-react";
import { loadUser, saveUser, loadGroup, saveGroup } from "./storage.js";

/* ============================================================
   FONTS
   ============================================================ */
const FONT_ID = "mf-fonts";
function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_ID)) return;
    const l = document.createElement("link");
    l.id = FONT_ID; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  }, []);
}

/* ============================================================
   DATA MODEL NOTES
   ------------------------------------------------------------
   This app persists through Vercel KV (Redis) via /api/kv, which
   stands in for a full relational database. The shapes below are
   written to map directly onto normalized backend tables if this
   is ever migrated to Postgres or similar:

     users, accounts, transactions, categories, budgets,
     savings_goals, recurring_transactions, groups, group_members,
     group_expenses, expense_splits, settlements, notifications,
     audit_log

   Personal data lives under key `mf:user:{accountId}` (private, enforced
   server-side against the signed-in session — see api/kv.js).
   Each group lives under its own key `mf:group:{id}` (shared),
   since multiple people read/write the same group.

   Money is stored in integer MINOR units (e.g. paise/cents) on
   every record to avoid floating point drift in balance math.
   Convert with toMinor()/fromMinor() at the UI boundary only.
   ============================================================ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

const toMinor = (v) => Math.round((parseFloat(v) || 0) * 100);
const fromMinor = (m) => (m || 0) / 100;

const CURRENCIES = {
  INR: { symbol: "₹", label: "Indian Rupee" },
  USD: { symbol: "$", label: "US Dollar" },
  EUR: { symbol: "€", label: "Euro" },
  GBP: { symbol: "£", label: "British Pound" },
};
function money(minor, currency = "INR") {
  const sym = CURRENCIES[currency]?.symbol || "";
  const n = fromMinor(minor);
  return (n < 0 ? "-" : "") + sym + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DEFAULT_CATEGORIES = [
  "Housing", "Food", "Groceries", "Transport", "Utilities", "Health",
  "Entertainment", "Shopping", "Lodging", "Savings", "Other",
];
const CAT_COLORS = {
  Housing: "#2F6F62", Food: "#D9A441", Groceries: "#4FB88F", Transport: "#5B7C99",
  Utilities: "#8C6E4C", Health: "#B5533C", Entertainment: "#7A6FA6", Shopping: "#C4436B",
  Lodging: "#E15B64", Savings: "#3E8E7E", Other: "#9A9587",
};
const catColor = (c) => CAT_COLORS[c] || "#9A9587";

const ACCOUNT_TYPES = ["Cash", "Bank Account", "Credit Card", "Wallet", "Savings Account"];
const ACCOUNT_ICONS = { "Cash": Banknote, "Bank Account": Landmark, "Credit Card": CreditCard, "Wallet": Wallet, "Savings Account": PiggyBank };

const TXN_TYPES = [
  { key: "expense", label: "Expense" },
  { key: "income", label: "Income" },
  { key: "transfer", label: "Transfer" },
  { key: "refund", label: "Refund" },
  { key: "debt", label: "Debt / IOU" },
];

const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"];

function addInterval(dateStr, freq) {
  const d = new Date(dateStr + "T00:00:00");
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "biweekly") d.setDate(d.getDate() + 14);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/* ============================================================
   STORAGE LAYER
   ============================================================ */
function emptyUserData(accountId, displayName) {
  return {
    id: accountId,             // stable identity, used as the storage key — never shown or editable
    name: displayName,         // editable display name, shown in groups/avatars/UI
    accounts: [{ id: uid(), name: "Cash", type: "Cash", startingBalanceMinor: 0, currency: "INR", active: true }],
    transactions: [],
    budgets: {},               // { category: limitMinor }
    budgetThresholds: [70, 90, 100],
    goals: [],
    recurringRules: [],
    debts: [],                 // personal IOUs outside of groups
    groups: [],                // [{id, name}]
    settings: { baseCurrency: "INR", categories: DEFAULT_CATEGORIES, aiEnabled: true, demoMode: true },
    auditLog: [],
    dismissedNudges: [],
  };
}

// loadUser / saveUser / loadGroup / saveGroup come from ./storage.js, which
// talks to /api/kv (backed by MongoDB) instead of the artifact's
// window.storage. Personal data is now keyed by the account's stable id
// (mf:user:{accountId}), not by display name, so renaming yourself later
// doesn't orphan your data. The API enforces that only the signed-in
// account can read/write its own mf:user:* key — see api/kv.js.

function emptyGroup(id, name, description, currency, members) {
  return { id, name, description: description || "", currency: currency || "INR", members, expenses: [], settlements: [], recurringRules: [] };
}

function audit(userData, action, detail) {
  const entry = { id: uid(), at: nowISO(), action, detail };
  const log = [entry, ...(userData.auditLog || [])].slice(0, 300);
  return { ...userData, auditLog: log };
}

/* ============================================================
   RECURRING ENGINE (shared logic for personal + group rules)
   ============================================================ */
function runRecurringRules(rules, onGenerate) {
  const postings = [];
  const nextRules = (rules || []).map((rule) => {
    let r = { ...rule };
    let guard = 0;
    while (r.active && r.nextDate <= todayISO() && (!r.endDate || r.nextDate <= r.endDate) && guard < 366) {
      const posting = onGenerate(r, r.nextDate);
      postings.push(posting);
      r.nextDate = addInterval(r.nextDate, r.freq);
      guard++;
    }
    if (r.endDate && r.nextDate > r.endDate) r.active = false;
    return r;
  });
  return { rules: nextRules, postings };
}

/* ============================================================
   APP SHELL
   ============================================================ */
const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "transactions", label: "Transactions", icon: List },
  { key: "budgets", label: "Budgets", icon: BarChart3 },
  { key: "goals", label: "Goals", icon: PiggyBank },
  { key: "groups", label: "Groups", icon: Users },
  { key: "recurring", label: "Recurring", icon: Repeat },
  { key: "insights", label: "Insights", icon: TrendingUp },
  { key: "settlements", label: "Settlements", icon: HandCoins },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];
const MOBILE_NAV_KEYS = ["overview", "transactions", "groups", "insights", "settings"];

export default function App() {
  useFonts();
  const [account, setAccount] = useState(null);       // { accountId, email, name } | null
  const [authChecking, setAuthChecking] = useState(true);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [groupsData, setGroupsData] = useState({});
  const [view, setView] = useState("overview");
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);

  const addToast = useCallback((type, message) => {
    const id = uid();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  /* ---------- restore session on load ---------- */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setAccount(data); })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  /* ---------- load personal data + run recurring on login ---------- */
  useEffect(() => {
    if (!account) return;
    setLoading(true);
    loadUser(account.accountId).then((existing) => {
      let data = existing || emptyUserData(account.accountId, account.name);
      // keep display name in sync if it was changed via the account record
      if (data.name !== account.name && !existing) data = { ...data, name: account.name };
      const { rules, postings } = runRecurringRules(data.recurringRules, (rule, date) => ({
        id: uid(), type: rule.type, amountMinor: rule.amountMinor, description: rule.description,
        category: rule.category, account: rule.account, currency: rule.currency || data.settings.baseCurrency,
        date, tags: rule.tags || [], notes: "", fromRule: rule.id, createdAt: nowISO(),
      }));
      if (postings.length) {
        data = { ...data, recurringRules: rules, transactions: [...postings, ...data.transactions] };
        data = audit(data, "recurring_generated", `${postings.length} transaction(s) auto-posted`);
      }
      setUserData(data);
      setLoading(false);
      if (postings.length) addToast("info", `${postings.length} recurring transaction${postings.length > 1 ? "s" : ""} posted`);
    });
  }, [account]); // eslint-disable-line

  /* ---------- debounce-save personal data ---------- */
  useEffect(() => {
    if (!account || !userData || loading) return;
    const t = setTimeout(() => saveUser(account.accountId, userData), 350);
    return () => clearTimeout(t);
  }, [userData, account, loading]);

  /* ---------- load all groups the user belongs to ---------- */
  useEffect(() => {
    if (!userData) return;
    let cancelled = false;
    (async () => {
      const ids = userData.groups.map((g) => g.id);
      const results = await Promise.all(ids.map((id) => loadGroup(id)));
      if (cancelled) return;
      const map = {};
      results.forEach((g, i) => {
        if (!g) return;
        const { rules, postings } = runRecurringRules(g.recurringRules, (rule, date) => ({
          id: uid(), description: rule.description, amountMinor: rule.amountMinor, paidBy: rule.paidBy,
          splitAmong: rule.splitAmong, splitType: rule.splitType, splitDetails: rule.splitDetails,
          category: rule.category, date, fromRule: rule.id, createdAt: nowISO(),
        }));
        let next = g;
        if (postings.length) {
          next = { ...g, recurringRules: rules, expenses: [...postings, ...g.expenses] };
          saveGroup(g.id, next);
        }
        map[g.id] = next;
      });
      setGroupsData(map);
    })();
    return () => { cancelled = true; };
  }, [userData?.groups?.length, account]); // eslint-disable-line

  const updateUser = useCallback((updater) => {
    setUserData((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const updateGroup = useCallback((id, updater) => {
    setGroupsData((prev) => {
      const next = typeof updater === "function" ? updater(prev[id]) : updater;
      saveGroup(id, next);
      return { ...prev, [id]: next };
    });
  }, []);

  const logout = () => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccount(null); setUserData(null); setGroupsData({}); setView("overview");
  };

  if (authChecking) return <FullScreenLoader />;
  if (!account) return <AuthScreen onAuthed={setAccount} />;
  if (!userData || loading) return <FullScreenLoader />;

  const ctx = { user: userData.name, accountId: account.accountId, userData, updateUser, groupsData, updateGroup, addToast, setView, activeGroupId, setActiveGroupId, setShowAddTxn };

  return (
    <div style={styles.app}>
      <GlobalStyle />
      <TopBar ctx={ctx} view={view} setView={setView} notifOpen={notifOpen} setNotifOpen={setNotifOpen} onLogout={logout} />
      <div style={styles.body}>
        <SideNav view={view} setView={(v) => { setView(v); setActiveGroupId(null); }} />
        <main style={styles.main}>
          {userData.settings.demoMode && <DemoBanner />}
          <ViewRouter view={view} ctx={ctx} />
        </main>
      </div>
      <MobileNav view={view} setView={(v) => { setView(v); setActiveGroupId(null); }} onAdd={() => setShowAddTxn(true)} />
      <ToastStack toasts={toasts} />
      {showAddTxn && <AddTransactionModal ctx={ctx} onClose={() => setShowAddTxn(false)} />}
    </div>
  );
}

function ViewRouter({ view, ctx }) {
  if (view === "overview") return <OverviewView ctx={ctx} />;
  if (view === "transactions") return <TransactionsView ctx={ctx} />;
  if (view === "budgets") return <BudgetsView ctx={ctx} />;
  if (view === "goals") return <GoalsView ctx={ctx} />;
  if (view === "groups") return <GroupsRouter ctx={ctx} />;
  if (view === "recurring") return <RecurringView ctx={ctx} />;
  if (view === "insights") return <InsightsView ctx={ctx} />;
  if (view === "settlements") return <SettlementsView ctx={ctx} />;
  if (view === "settings") return <SettingsView ctx={ctx} />;
  return null;
}
function OverviewView({ ctx }) {
  const { userData, groupsData, setView, setActiveGroupId, setShowAddTxn } = ctx;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const balance = totalNetWorth(userData);
  const monthTxns = userData.transactions.filter((t) => t.date.slice(0, 7) === currentMonth);
  const monthIncome = monthTxns.filter((t) => t.type === "income").reduce((s, t) => s + t.amountMinor, 0);
  const monthExpense = monthTxns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountMinor, 0);
  const totalBudget = Object.values(userData.budgets).reduce((s, v) => s + v, 0);
  const remainingBudget = totalBudget > 0 ? totalBudget - monthExpense : null;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
  const lastMonthExpense = userData.transactions.filter((t) => t.type === "expense" && t.date.slice(0, 7) === lastMonthKey).reduce((s, t) => s + t.amountMinor, 0);
  const healthLine = lastMonthExpense > 0
    ? `You're spending ${Math.abs(Math.round(((monthExpense - lastMonthExpense) / lastMonthExpense) * 100))}% ${monthExpense <= lastMonthExpense ? "less" : "more"} than last month (estimate).`
    : "Add a few more transactions to see monthly comparisons.";

  const byCategory = useMemo(() => {
    const m = {};
    monthTxns.filter((t) => t.type === "expense").forEach((t) => { m[t.category] = (m[t.category] || 0) + t.amountMinor; });
    return Object.entries(m).map(([name, value]) => ({ name, value: fromMinor(value) }));
  }, [monthTxns]);

  const byMonth6 = useMemo(() => {
    const m = {};
    userData.transactions.forEach((t) => {
      if (t.type !== "income" && t.type !== "expense") return;
      const k = t.date.slice(0, 7);
      if (!m[k]) m[k] = { month: k, income: 0, expense: 0 };
      m[k][t.type] += fromMinor(t.amountMinor);
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }, [userData.transactions]);

  const upcomingRecurring = useMemo(() => [...userData.recurringRules].filter((r) => r.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 5), [userData.recurringRules]);
  const goalSummaries = useMemo(() => {
    const contrib = {};
    userData.transactions.filter((t) => t.goalId).forEach((t) => { contrib[t.goalId] = (contrib[t.goalId] || 0) + t.amountMinor; });
    return userData.goals.map((g) => ({ ...g, saved: contrib[g.id] || 0, pct: g.targetMinor > 0 ? Math.min(100, ((contrib[g.id] || 0) / g.targetMinor) * 100) : 0 }));
  }, [userData.goals, userData.transactions]);

  const budgetWarnings = useMemo(() => {
    return userData.settings.categories.map((cat) => {
      const spent = monthTxns.filter((t) => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amountMinor, 0);
      const limit = userData.budgets[cat] || 0;
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      return { cat, spent, limit, pct };
    }).filter((b) => b.limit > 0 && b.pct >= (userData.budgetThresholds[0] || 70));
  }, [monthTxns, userData.budgets, userData.settings.categories, userData.budgetThresholds]);

  let groupOwedToMe = 0, groupIOwe = 0;
  userData.groups.forEach((g) => {
    const gd = groupsData[g.id];
    if (!gd) return;
    const { net } = computeGroupBalances(gd.members, gd.expenses, gd.settlements);
    const mine = net[userData.name] || 0;
    if (mine > 1) groupOwedToMe += mine; else if (mine < -1) groupIOwe += -mine;
  });

  return (
    <div>
      <div style={styles.rowHead}>
        <h1 style={styles.pageTitle}>Welcome back, {userData.name}</h1>
        <div style={styles.quickActions}>
          <QuickAction icon={Plus} label="Add expense" onClick={() => setShowAddTxn(true)} />
          <QuickAction icon={Users} label="Group expense" onClick={() => setShowAddTxn(true)} />
          <QuickAction icon={Target} label="Savings goal" onClick={() => setView("goals")} />
          <QuickAction icon={HandCoins} label="Settle up" onClick={() => setView("settlements")} />
        </div>
      </div>

      <div style={styles.healthLine}><Sparkles size={13} /> {healthLine}</div>

      <div style={styles.statGrid}>
        <StatCard label="Net worth (all accounts)" value={money(balance)} color={balance >= 0 ? "#2F6F62" : "#B5533C"} />
        <StatCard label="Income this month" value={money(monthIncome)} color="#2F6F62" />
        <StatCard label="Spent this month" value={money(monthExpense)} color="#B5533C" />
        <StatCard label="Budget remaining" value={remainingBudget === null ? "—" : money(remainingBudget)} color={remainingBudget !== null && remainingBudget < 0 ? "#B5533C" : "#5B7C99"} />
        <StatCard label="Owed to you (groups)" value={money(groupOwedToMe)} color="#4FB88F" />
        <StatCard label="You owe (groups)" value={money(groupIOwe)} color="#C4436B" />
      </div>

      {budgetWarnings.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Budget warnings</h2>
          {budgetWarnings.map((b) => (
            <div key={b.cat} style={{ fontSize: 12.5, color: "#6B695E", padding: "4px 0" }}>
              <b>{b.cat}</b> is at {b.pct.toFixed(0)}% of its {money(b.limit)} budget ({money(b.spent)} spent).
            </div>
          ))}
        </div>
      )}

      <div style={styles.twoCol}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Spending by category, this month</h2>
          {byCategory.length === 0 ? <EmptyState text="No expenses yet this month." /> : (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={42} outerRadius={78} paddingAngle={2}>
                  {byCategory.map((entry, i) => <Cell key={i} fill={catColor(entry.name)} />)}
                </Pie>
                <Tooltip formatter={(v) => money(toMinor(v))} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Income vs. expense, last 6 months</h2>
          {byMonth6.length === 0 ? <EmptyState text="Your trend will appear as you log transactions." /> : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={byMonth6}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3E0D5" />
                <XAxis dataKey="month" tick={{ fontFamily: "IBM Plex Mono", fontSize: 10 }} />
                <YAxis tick={{ fontFamily: "IBM Plex Mono", fontSize: 10 }} />
                <Tooltip formatter={(v) => money(toMinor(v))} contentStyle={tooltipStyle} />
                <Bar dataKey="income" fill="#2F6F62" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#B5533C" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Upcoming bills</h2>
          {upcomingRecurring.length === 0 ? <EmptyState text="No recurring items scheduled." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {upcomingRecurring.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #EDEBDF" }}>
                  <span>{r.description} <span style={{ color: "#9A9587" }}>· {r.freq}</span></span>
                  <span style={{ fontFamily: "IBM Plex Mono", color: txnColor(r.type) }}>{r.nextDate} · {money(r.amountMinor, r.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Savings goals</h2>
          {goalSummaries.length === 0 ? <EmptyState text="No goals yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {goalSummaries.map((g) => (
                <div key={g.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}><span>{g.name}</span><span>{g.pct.toFixed(0)}%</span></div>
                  <div style={styles.budgetBarTrack}><div style={{ ...styles.budgetBarFill, width: `${g.pct}%`, background: "#3E8E7E" }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function QuickAction({ icon: Icon, label, onClick }) {
  return <button style={styles.quickActionBtn} onClick={onClick}><Icon size={14} /> {label}</button>;
}

/* ============================================================
   ACCOUNT BALANCE (derived, never stored mutably — avoids drift)
   ============================================================ */
function accountBalance(account, transactions) {
  let bal = account.startingBalanceMinor;
  transactions.forEach((t) => {
    if (t.type === "transfer") {
      if (t.fromAccount === account.id) bal -= t.amountMinor;
      if (t.toAccount === account.id) bal += t.amountMinor;
    } else if (t.account === account.id) {
      if (t.type === "income" || t.type === "refund") bal += t.amountMinor;
      else if (t.type === "expense") bal -= t.amountMinor;
    }
  });
  return bal;
}
function totalNetWorth(userData) {
  return userData.accounts.filter((a) => a.active !== false).reduce((s, a) => s + accountBalance(a, userData.transactions), 0);
}

/* ============================================================
   TRANSACTIONS VIEW — search, filters, sort, list
   ============================================================ */
function TransactionsView({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [accFilter, setAccFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const accountsById = useMemo(() => Object.fromEntries(userData.accounts.map((a) => [a.id, a])), [userData.accounts]);

  const filtered = useMemo(() => {
    let list = userData.transactions.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (catFilter !== "all" && t.category !== catFilter) return false;
      if (accFilter !== "all" && t.account !== accFilter && t.fromAccount !== accFilter && t.toAccount !== accFilter) return false;
      if (q.trim()) {
        const hay = `${t.description} ${t.category || ""} ${(t.tags || []).join(" ")} ${t.notes || ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      if (sort === "newest") return b.date.localeCompare(a.date) || b.createdAt?.localeCompare(a.createdAt || "");
      if (sort === "oldest") return a.date.localeCompare(b.date);
      if (sort === "highest") return b.amountMinor - a.amountMinor;
      if (sort === "lowest") return a.amountMinor - b.amountMinor;
      return 0;
    });
    return list;
  }, [userData.transactions, q, typeFilter, catFilter, accFilter, sort]);

  const removeTxn = (id) => {
    updateUser((prev) => {
      const t = prev.transactions.find((x) => x.id === id);
      let next = { ...prev, transactions: prev.transactions.filter((x) => x.id !== id) };
      next = audit(next, "transaction_deleted", t ? `${t.description} (${money(t.amountMinor, t.currency)})` : id);
      return next;
    });
    addToast("info", "Transaction deleted");
  };

  return (
    <div>
      <div style={styles.rowHead}>
        <h1 style={styles.pageTitle}>Transactions</h1>
      </div>

      <div style={styles.filterBar}>
        <div style={styles.searchBox}>
          <Search size={14} color="#9A9587" />
          <input style={styles.searchInput} placeholder="Search description, category, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select style={styles.filterSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {TXN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select style={styles.filterSelect} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {userData.settings.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={styles.filterSelect} value={accFilter} onChange={(e) => setAccFilter(e.target.value)}>
          <option value="all">All accounts</option>
          {userData.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select style={styles.filterSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="highest">Highest amount</option>
          <option value="lowest">Lowest amount</option>
        </select>
      </div>

      <div style={styles.card}>
        {filtered.length === 0 ? <EmptyState text="No transactions match. Try clearing filters, or add your first transaction." /> : (
          <div>
            <div style={styles.txnHeadRow}>
              <span>Date</span><span>Description</span><span>Category</span><span>Account</span><span style={{ textAlign: "right" }}>Amount</span><span />
            </div>
            {filtered.map((t) => (
              <div key={t.id} style={styles.txnRow}>
                <span style={styles.mono11}>{t.date}</span>
                <span>
                  {t.description}
                  {t.fromRule && <Repeat size={11} style={{ verticalAlign: -1, marginLeft: 5, opacity: 0.5 }} title="Auto-generated" />}
                  {t.tags?.length > 0 && <span style={styles.tagRow}>{t.tags.map((tag) => <span key={tag} style={styles.tagChip}>{tag}</span>)}</span>}
                </span>
                <span><span style={{ ...styles.catTag, background: catColor(t.category) + "22", color: catColor(t.category) }}>{t.category || "—"}</span></span>
                <span style={{ fontSize: 12, color: "#6B695E" }}>
                  {t.type === "transfer" ? `${accountsById[t.fromAccount]?.name || "?"} → ${accountsById[t.toAccount]?.name || "?"}` : accountsById[t.account]?.name || "—"}
                </span>
                <span style={{ textAlign: "right", fontFamily: "IBM Plex Mono", fontSize: 13, color: txnColor(t.type) }}>
                  {txnSign(t.type)}{money(t.amountMinor, t.currency)}
                </span>
                <button style={styles.iconBtn} onClick={() => removeTxn(t.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function txnColor(type) { return type === "income" || type === "refund" ? "#2F6F62" : type === "expense" ? "#B5533C" : "#5B7C99"; }
function txnSign(type) { return type === "income" || type === "refund" ? "+" : type === "expense" ? "-" : ""; }

function EmptyState({ text, icon: Icon }) {
  return (
    <div style={styles.emptyState}>
      {Icon ? <Icon size={22} color="#B9B6A8" /> : null}
      <span>{text}</span>
    </div>
  );
}

/* ============================================================
   ADD TRANSACTION MODAL — personal/group, all types, AI suggest
   ============================================================ */
function AddTransactionModal({ ctx, onClose }) {
  const { userData, updateUser, addToast, groupsData, updateGroup } = ctx;
  const [scope, setScope] = useState("personal");
  const [type, setType] = useState("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(userData.settings.categories[0]);
  const [account, setAccount] = useState(userData.accounts[0]?.id || "");
  const [toAccount, setToAccount] = useState(userData.accounts[1]?.id || userData.accounts[0]?.id || "");
  const [currency, setCurrency] = useState(userData.settings.baseCurrency);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [debtPerson, setDebtPerson] = useState("");
  const [debtDirection, setDebtDirection] = useState("owed_to_me");
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [freq, setFreq] = useState("monthly");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [groupId, setGroupId] = useState(userData.groups[0]?.id || "");
  const group = groupsData[groupId];
  const [paidBy, setPaidBy] = useState(userData.name);
  const [splitAmong, setSplitAmong] = useState([]);
  const [splitType, setSplitType] = useState("equal");
  const [splitDetails, setSplitDetails] = useState({});
  useEffect(() => { if (group) { setSplitAmong(group.members); setPaidBy(userData.name); } }, [groupId]); // eslint-disable-line

  const runAI = async () => {
    if (!description.trim() || !userData.settings.aiEnabled) return;
    setAiLoading(true);
    try {
      // This calls our own serverless function (api/ai-suggest.js), which holds
      // the Anthropic API key server-side. The browser never sees the key.
      const res = await fetch("/api/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, categories: userData.settings.categories }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI suggestion failed");
      }
      const parsed = await res.json();
      setAiSuggestion(parsed);
    } catch (e) { addToast("error", e.message || "Couldn't get an AI suggestion right now."); }
    setAiLoading(false);
  };
  const acceptAI = () => {
    if (!aiSuggestion) return;
    if (userData.settings.categories.includes(aiSuggestion.category)) setCategory(aiSuggestion.category);
    if (TXN_TYPES.some((t) => t.key === aiSuggestion.type)) setType(aiSuggestion.type);
    if (aiSuggestion.tags?.length) setTagsInput(aiSuggestion.tags.join(", "));
    setAiSuggestion(null);
  };

  const submitPersonal = () => {
    if (type === "debt") { addDebt(); return; }
    const amt = toMinor(amount);
    if (amt <= 0 || !description.trim()) { addToast("error", "Add a description and amount."); return; }
    const tags = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);
    const base = { id: uid(), description: description.trim(), amountMinor: amt, category: type === "transfer" ? null : category, currency, date, notes, tags, createdAt: nowISO() };
    let txn;
    if (type === "transfer") txn = { ...base, type, fromAccount: account, toAccount, description: description.trim() || "Transfer" };
    else txn = { ...base, type, account };

    updateUser((prev) => {
      let next = { ...prev, transactions: [txn, ...prev.transactions] };
      next = audit(next, "transaction_created", `${txn.type}: ${txn.description} (${money(txn.amountMinor, txn.currency)})`);
      return next;
    });

    if (makeRecurring && type !== "transfer") {
      updateUser((prev) => ({
        ...prev,
        recurringRules: [...prev.recurringRules, {
          id: uid(), type, amountMinor: amt, description: description.trim(), category, account, currency, tags,
          freq, nextDate: addInterval(date, freq), endDate: null, active: true,
        }],
      }));
    }
    addToast("success", "Transaction added");
    onClose();
  };

  const addDebt = () => {
    const amt = toMinor(amount);
    if (amt <= 0 || !debtPerson.trim()) { addToast("error", "Add a person and amount."); return; }
    updateUser((prev) => ({ ...prev, debts: [{ id: uid(), person: debtPerson.trim(), amountMinor: amt, currency, direction: debtDirection, date, notes, settled: false }, ...prev.debts] }));
    addToast("success", "IOU recorded");
    onClose();
  };

  const submitGroup = () => {
    const amt = toMinor(amount);
    if (!group || amt <= 0 || !description.trim() || splitAmong.length === 0) { addToast("error", "Fill in the expense details."); return; }
    let details = null;
    if (splitType === "exact") {
      const sum = splitAmong.reduce((s, m) => s + toMinor(splitDetails[m] || 0), 0);
      if (sum !== amt) { addToast("error", "Exact amounts must add up to the total."); return; }
      details = Object.fromEntries(splitAmong.map((m) => [m, toMinor(splitDetails[m] || 0)]));
    } else if (splitType === "percentage") {
      const sum = splitAmong.reduce((s, m) => s + (parseFloat(splitDetails[m]) || 0), 0);
      if (Math.abs(sum - 100) > 0.01) { addToast("error", "Percentages must add up to 100%."); return; }
      details = Object.fromEntries(splitAmong.map((m) => [m, Math.round((amt * (parseFloat(splitDetails[m]) || 0)) / 100)]));
    }
    const expense = { id: uid(), description: description.trim(), amountMinor: amt, paidBy, splitAmong, splitType, splitDetails: details, category, date, createdAt: nowISO() };
    updateGroup(groupId, (g) => ({ ...g, expenses: [expense, ...g.expenses] }));
    addToast("success", "Group expense added");
    onClose();
  };

  const toggleSplitMember = (m) => setSplitAmong((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, width: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeadRow}>
          <h2 style={styles.modalTitle}>Add transaction</h2>
          <button style={styles.iconBtn} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={styles.scopeToggle}>
          <button onClick={() => setScope("personal")} style={{ ...styles.scopeBtn, ...(scope === "personal" ? styles.scopeBtnActive : {}) }}>Personal</button>
          <button onClick={() => setScope("group")} style={{ ...styles.scopeBtn, ...(scope === "group" ? styles.scopeBtnActive : {}) }} disabled={userData.groups.length === 0}>Group</button>
        </div>

        {scope === "personal" ? (
          <div style={styles.form}>
            <div style={styles.typeRow}>
              {TXN_TYPES.map((t) => (
                <button key={t.key} onClick={() => setType(t.key)} style={{ ...styles.typeChip, ...(type === t.key ? { background: txnColor(t.key), color: "#fff", borderColor: txnColor(t.key) } : {}) }}>{t.label}</button>
              ))}
            </div>

            <div style={styles.formRow}>
              <input style={{ ...styles.input, flex: 1 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
              <button type="button" style={styles.suggestBtn} onClick={runAI} disabled={aiLoading || !userData.settings.aiEnabled} title="AI categorize">
                {aiLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              </button>
            </div>
            {aiSuggestion && (
              <div style={styles.aiSuggestBox}>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  Suggested: <b>{aiSuggestion.category}</b> · {aiSuggestion.type}{aiSuggestion.tags?.length ? ` · tags: ${aiSuggestion.tags.join(", ")}` : ""}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={styles.miniAcceptBtn} onClick={acceptAI}><Check size={12} /> Apply</button>
                  <button style={styles.miniRejectBtn} onClick={() => setAiSuggestion(null)}>Dismiss</button>
                </div>
              </div>
            )}

            <div style={styles.formRow}>
              <input style={styles.input} type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select style={styles.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input style={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            {type === "debt" ? (
              <>
                <div style={styles.formRow}>
                  <input style={styles.input} placeholder="Person's name" value={debtPerson} onChange={(e) => setDebtPerson(e.target.value)} />
                  <select style={styles.input} value={debtDirection} onChange={(e) => setDebtDirection(e.target.value)}>
                    <option value="owed_to_me">They owe me</option>
                    <option value="i_owe">I owe them</option>
                  </select>
                </div>
              </>
            ) : type === "transfer" ? (
              <div style={styles.formRow}>
                <select style={styles.input} value={account} onChange={(e) => setAccount(e.target.value)}>
                  {userData.accounts.map((a) => <option key={a.id} value={a.id}>From: {a.name}</option>)}
                </select>
                <select style={styles.input} value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                  {userData.accounts.map((a) => <option key={a.id} value={a.id}>To: {a.name}</option>)}
                </select>
              </div>
            ) : (
              <div style={styles.formRow}>
                <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {userData.settings.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select style={styles.input} value={account} onChange={(e) => setAccount(e.target.value)}>
                  {userData.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            <input style={styles.input} placeholder="Tags, comma separated (optional)" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
            <textarea style={{ ...styles.input, resize: "vertical", minHeight: 50 }} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

            {type !== "transfer" && type !== "debt" && (
              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={makeRecurring} onChange={(e) => setMakeRecurring(e.target.checked)} />
                <span>Make this recurring</span>
                {makeRecurring && (
                  <select style={{ ...styles.input, width: 120, marginLeft: "auto" }} value={freq} onChange={(e) => setFreq(e.target.value)}>
                    {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                )}
              </label>
            )}

            <button style={{ ...styles.primaryBtn, justifyContent: "center", marginTop: 4 }} onClick={submitPersonal}><Plus size={15} /> Add transaction</button>
          </div>
        ) : (
          <div style={styles.form}>
            {userData.groups.length === 0 ? <EmptyState text="You're not in any groups yet — create one from the Groups tab." /> : (
              <>
                <select style={styles.input} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  {userData.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {group && (
                  <>
                    <input style={styles.input} placeholder="What was it for?" value={description} onChange={(e) => setDescription(e.target.value)} />
                    <div style={styles.formRow}>
                      <input style={styles.input} type="number" placeholder="Total amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                      <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>
                        {userData.settings.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <label style={styles.label}>Paid by</label>
                    <select style={styles.input} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                      {group.members.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <label style={styles.label}>Split among</label>
                    <div style={styles.chipRow}>
                      {group.members.map((m) => (
                        <button key={m} type="button" onClick={() => toggleSplitMember(m)} style={{ ...styles.chip, border: "none", cursor: "pointer", ...(splitAmong.includes(m) ? styles.chipActive : {}) }}>{m}</button>
                      ))}
                    </div>
                    <SplitTypeEditor splitAmong={splitAmong} splitType={splitType} setSplitType={setSplitType} splitDetails={splitDetails} setSplitDetails={setSplitDetails} amount={amount} />
                    <button style={{ ...styles.primaryBtn, justifyContent: "center", marginTop: 4 }} onClick={submitGroup}><Plus size={15} /> Add group expense</button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SplitTypeEditor({ splitAmong, splitType, setSplitType, splitDetails, setSplitDetails, amount }) {
  const total = parseFloat(amount) || 0;
  const setDetail = (m, v) => setSplitDetails({ ...splitDetails, [m]: v });
  const exactSum = splitAmong.reduce((s, m) => s + (parseFloat(splitDetails[m]) || 0), 0);
  const pctSum = splitAmong.reduce((s, m) => s + (parseFloat(splitDetails[m]) || 0), 0);
  return (
    <div>
      <div style={styles.splitTypeRow}>
        {["equal", "exact", "percentage"].map((t) => (
          <button key={t} type="button" onClick={() => setSplitType(t)} style={{ ...styles.splitTypeBtn, ...(splitType === t ? styles.splitTypeBtnActive : {}) }}>
            {t === "equal" ? "Equal" : t === "exact" ? "Exact $" : "Percent %"}
          </button>
        ))}
      </div>
      {splitType === "exact" && (
        <div style={styles.splitDetailList}>
          {splitAmong.map((m) => (
            <div key={m} style={styles.splitDetailRow}>
              <span>{m}</span>
              <input style={styles.splitDetailInput} type="number" min="0" placeholder="0.00" value={splitDetails[m] || ""} onChange={(e) => setDetail(m, e.target.value)} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: Math.abs(exactSum - total) < 0.01 ? "#4FB88F" : "#C4436B", marginTop: 4 }}>{exactSum.toFixed(2)} of {total.toFixed(2)} allocated</div>
        </div>
      )}
      {splitType === "percentage" && (
        <div style={styles.splitDetailList}>
          {splitAmong.map((m) => (
            <div key={m} style={styles.splitDetailRow}>
              <span>{m}</span>
              <input style={styles.splitDetailInput} type="number" min="0" placeholder="0" value={splitDetails[m] || ""} onChange={(e) => setDetail(m, e.target.value)} />
              <span style={{ fontSize: 11, color: "#9A94A0" }}>%</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: Math.abs(pctSum - 100) < 0.01 ? "#4FB88F" : "#C4436B", marginTop: 4 }}>{pctSum}% of 100%</div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TOP BAR / NAV / SCAFFOLDING
   ============================================================ */
function TopBar({ ctx, view, setView, notifOpen, setNotifOpen, onLogout }) {
  const notifs = useMemo(() => computeNotifications(ctx.userData, ctx.groupsData), [ctx.userData, ctx.groupsData]);
  return (
    <header style={styles.topbar}>
      <div style={styles.brand}>
        <Wallet size={20} color="#F2F1EC" />
        <span style={styles.brandText}>MoneyFlow</span>
      </div>
      <button style={styles.addBtn} onClick={() => ctx.setShowAddTxn(true)}><Plus size={14} /> Add transaction</button>
      <div style={styles.topRight}>
        <div style={{ position: "relative" }}>
          <button style={styles.iconTopBtn} onClick={() => setNotifOpen((o) => !o)}>
            <Bell size={16} />
            {notifs.length > 0 && <span style={styles.badge}>{notifs.length}</span>}
          </button>
          {notifOpen && <NotificationPanel notifs={notifs} onClose={() => setNotifOpen(false)} />}
        </div>
        <button style={styles.logoutBtn} onClick={onLogout}><LogOut size={13} /> {ctx.user}</button>
      </div>
    </header>
  );
}

function SideNav({ view, setView }) {
  return (
    <nav style={styles.sideNav} className="mf-side-nav">
      {NAV.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => setView(key)} style={{ ...styles.navBtn, ...(view === key ? styles.navBtnActive : {}) }}>
          <Icon size={16} /> <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function MobileNav({ view, setView, onAdd }) {
  return (
    <nav style={styles.mobileNav} className="mf-mobile-nav">
      {NAV.filter((n) => MOBILE_NAV_KEYS.includes(n.key)).map(({ key, label, icon: Icon }, i) => (
        <React.Fragment key={key}>
          <button onClick={() => setView(key)} style={{ ...styles.mobileNavBtn, ...(view === key ? styles.mobileNavBtnActive : {}) }}>
            <Icon size={18} /><span style={{ fontSize: 9.5 }}>{label}</span>
          </button>
          {i === 1 && (
            <button onClick={onAdd} style={styles.mobileFab}><Plus size={20} color="#fff" /></button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function DemoBanner() {
  return (
    <div style={styles.demoBanner}>
      <Info size={13} />
      <span>Your account is password-protected and your personal data is private to you. Groups are shared with anyone who has the group — no payments or push notifications are sent by this app.</span>
    </div>
  );
}

function AuthScreen({ onAuthed }) {
  useFonts();
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchMode = (m) => { setMode(m); setError(""); };

  const submit = async () => {
    setError("");
    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !normEmail.includes("@")) { setError("Enter a valid email address."); return; }
    if (!password) { setError("Enter your password."); return; }
    if (mode === "signup") {
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (password !== confirmPassword) { setError("Passwords don't match."); return; }
      if (!name.trim()) { setError("Enter a display name — this is what shows up in your groups."); return; }
    }

    setBusy(true);
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { email: normEmail, password, name: name.trim() } : { email: normEmail, password }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = { error: `The server returned an unexpected response (${res.status}).` };
      }
      if (!res.ok) { setError(data.error || "Something went wrong."); setBusy(false); return; }
      onAuthed(data);
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
      setBusy(false);
    }
  };

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <Wallet size={28} color="#2F6F62" />
        <h1 style={styles.loginTitle}>MoneyFlow</h1>
        <p style={styles.loginSub}>Personal finance and shared expenses, in one place.</p>

        <div style={styles.scopeToggle}>
          <button type="button" onClick={() => switchMode("login")} style={{ ...styles.scopeBtn, ...(mode === "login" ? styles.scopeBtnActive : {}) }}>Log in</button>
          <button type="button" onClick={() => switchMode("signup")} style={{ ...styles.scopeBtn, ...(mode === "signup" ? styles.scopeBtnActive : {}) }}>Sign up</button>
        </div>

        <form style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {mode === "signup" && (
            <input style={styles.input} placeholder="Display name (shown in your groups)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <input style={styles.input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input style={styles.input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          {mode === "signup" && (
            <input style={styles.input} type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          )}
          {error && <div style={styles.authError}>{error}</div>}
          <button type="submit" style={{ ...styles.primaryBtn, width: "100%", justifyContent: "center", marginTop: 4 }} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>

        <p style={styles.loginNote}>
          {mode === "signup"
            ? "Your password is hashed before it's ever stored. Personal data is private to your account; group data is shared with anyone who has that group."
            : "Don't have an account yet? Switch to Sign up above."}
        </p>
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return <div style={styles.loaderWrap}><Loader2 className="spin" size={22} color="#2F6F62" /></div>;
}

function ToastStack({ toasts }) {
  return (
    <div style={styles.toastStack}>
      {toasts.map((t) => (
        <div key={t.id} style={{ ...styles.toast, borderLeftColor: t.type === "error" ? "#B5533C" : t.type === "success" ? "#2F6F62" : "#5B7C99" }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function NotificationPanel({ notifs, onClose }) {
  return (
    <div style={styles.notifPanel}>
      <div style={styles.notifHead}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Notifications</span>
        <button style={styles.iconBtn} onClick={onClose}><X size={14} /></button>
      </div>
      {notifs.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12.5, color: "#9A9587", textAlign: "center" }}>You're all caught up.</div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {notifs.map((n) => (
            <div key={n.id} style={styles.notifRow}>
              <div style={{ ...styles.notifDot, background: n.level === "warn" ? "#B5533C" : n.level === "caution" ? "#D9A441" : "#5B7C99" }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 11.5, color: "#8A8A7E" }}>{n.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function computeNotifications(userData, groupsData) {
  if (!userData) return [];
  const notifs = [];
  const now = new Date();
  const soon = new Date(now); soon.setDate(soon.getDate() + 3);

  (userData.recurringRules || []).filter((r) => r.active).forEach((r) => {
    const due = new Date(r.nextDate);
    if (due < now) notifs.push({ id: `od-${r.id}`, level: "warn", title: `Overdue: ${r.description}`, detail: `Was due ${r.nextDate} · ${money(r.amountMinor, r.currency)}` });
    else if (due <= soon) notifs.push({ id: `up-${r.id}`, level: "caution", title: `Upcoming: ${r.description}`, detail: `Due ${r.nextDate} · ${money(r.amountMinor, r.currency)}` });
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  const spent = {};
  (userData.transactions || []).filter((t) => t.type === "expense" && t.date.slice(0, 7) === currentMonth).forEach((t) => { spent[t.category] = (spent[t.category] || 0) + t.amountMinor; });
  Object.entries(userData.budgets || {}).forEach(([cat, limit]) => {
    if (!limit) return;
    const pct = ((spent[cat] || 0) / limit) * 100;
    const threshold = (userData.budgetThresholds || [70, 90, 100]).find((t) => pct >= t && pct < t + 100 / (userData.budgetThresholds?.length || 1) * 0 + 1000);
    if (pct >= (userData.budgetThresholds?.[0] || 70)) {
      notifs.push({ id: `bud-${cat}`, level: pct >= 100 ? "warn" : "caution", title: `${cat} budget at ${pct.toFixed(0)}%`, detail: `${money(spent[cat] || 0)} of ${money(limit)} spent this month` });
    }
  });

  (userData.goals || []).forEach((g) => {
    if (!g.deadline) return;
    const days = Math.ceil((new Date(g.deadline) - now) / 86400000);
    if (days >= 0 && days <= 7) notifs.push({ id: `goal-${g.id}`, level: "caution", title: `${g.name} deadline in ${days}d`, detail: `Target ${money(g.targetMinor)} by ${g.deadline}` });
  });

  (userData.groups || []).forEach((gRef) => {
    const g = groupsData[gRef.id];
    if (!g) return;
    const { net } = computeGroupBalances(g.members, g.expenses, g.settlements);
    const mine = net[userData.name] || 0;
    if (mine < -1) notifs.push({ id: `set-${g.id}`, level: "caution", title: `You owe in ${g.name}`, detail: `${money(-mine, g.currency)} outstanding` });
  });

  return notifs.slice(0, 20);
}

function GlobalStyle() {
  return (
    <style>{`
      @keyframes mf-spin { to { transform: rotate(360deg); } }
      .spin { animation: mf-spin 1s linear infinite; }
      .mf-mobile-nav { display: none; }
      @media (max-width: 860px) {
        .mf-side-nav { display: none !important; }
        .mf-mobile-nav { display: flex !important; }
      }
      input::placeholder, textarea::placeholder { color: #A6A395; }
    `}</style>
  );
}

/* ============================================================
   BUDGETS VIEW
   ============================================================ */
function monthKey(d) { return d.slice(0, 7); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function BudgetsView({ ctx }) {
  const { userData, updateUser } = ctx;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const dayOfMonth = now.getDate();

  const spentThisMonth = useMemo(() => {
    const m = {};
    userData.transactions.filter((t) => monthKey(t.date) === currentMonth && (t.type === "expense" || t.type === "refund")).forEach((t) => {
      const sign = t.type === "refund" ? -1 : 1;
      m[t.category] = (m[t.category] || 0) + sign * t.amountMinor;
    });
    return m;
  }, [userData.transactions, currentMonth]);

  const totalBudget = Object.values(userData.budgets).reduce((s, v) => s + v, 0);
  const totalSpent = Object.values(spentThisMonth).reduce((s, v) => s + v, 0);

  const setBudget = (cat, minor) => updateUser((prev) => ({ ...prev, budgets: { ...prev.budgets, [cat]: minor } }));
  const setThresholds = (arr) => updateUser((prev) => ({ ...prev, budgetThresholds: arr }));

  return (
    <div>
      <h1 style={styles.pageTitle}>Budgets</h1>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>This month overall</h2>
        <div style={styles.budgetBarTrack}>
          <div style={{ ...styles.budgetBarFill, width: `${totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0}%`, background: totalBudget > 0 && totalSpent > totalBudget ? "#B5533C" : "#2F6F62" }} />
        </div>
        <div style={styles.budgetFoot}><span>{money(totalSpent)} spent</span>{totalBudget > 0 && <span>of {money(totalBudget)}</span>}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#6B695E" }}>Warn at:</span>
          {userData.budgetThresholds.map((th, i) => (
            <input key={i} type="number" value={th} style={styles.thresholdInput}
              onChange={(e) => { const arr = [...userData.budgetThresholds]; arr[i] = Number(e.target.value) || 0; setThresholds(arr); }} />
          ))}
          <span style={{ fontSize: 12, color: "#6B695E" }}>%</span>
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>By category</h2>
        <div style={styles.budgetGrid}>
          {userData.settings.categories.map((cat) => {
            const spent = spentThisMonth[cat] || 0;
            const limit = userData.budgets[cat] || 0;
            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
            const projected = dayOfMonth > 0 ? (spent / dayOfMonth) * dim : spent;
            const willExceed = limit > 0 && projected > limit;
            const highestThreshold = Math.max(...userData.budgetThresholds, 0);
            const overThreshold = limit > 0 && (spent / limit) * 100 >= (userData.budgetThresholds[0] || 70);
            return (
              <div key={cat} style={styles.budgetRow}>
                <div style={styles.budgetTop}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{cat}</span>
                  <input type="number" placeholder="limit" value={limit ? fromMinor(limit) : ""} style={styles.budgetInput}
                    onChange={(e) => setBudget(cat, toMinor(e.target.value))} />
                </div>
                <div style={styles.budgetBarTrack}>
                  <div style={{ ...styles.budgetBarFill, width: `${pct}%`, background: limit > 0 && spent > limit ? "#B5533C" : overThreshold ? "#D9A441" : catColor(cat) }} />
                </div>
                <div style={styles.budgetFoot}>
                  <span style={{ color: limit > 0 && spent > limit ? "#B5533C" : "#6B695E" }}>{money(spent)} spent</span>
                  {limit > 0 && <span style={{ color: "#9A9587" }}>of {money(limit)} ({pct.toFixed(0)}%)</span>}
                </div>
                {willExceed && <div style={styles.forecastWarn}><AlertTriangle size={11} /> Estimated pace: {money(projected)} by month end</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   GOALS VIEW
   ============================================================ */
function monthsBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(1, (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() >= d1.getDate() ? 0 : -1) + 1);
}

function GoalsView({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [accountId, setAccountId] = useState(userData.accounts[0]?.id || "");
  const [amt, setAmt] = useState({});

  const contributions = useMemo(() => {
    const m = {};
    userData.transactions.filter((t) => t.goalId).forEach((t) => { m[t.goalId] = (m[t.goalId] || 0) + t.amountMinor; });
    return m;
  }, [userData.transactions]);

  const addGoal = () => {
    const t = toMinor(target);
    if (!name.trim() || t <= 0) { addToast("error", "Give the goal a name and target."); return; }
    updateUser((prev) => ({ ...prev, goals: [...prev.goals, { id: uid(), name: name.trim(), targetMinor: t, deadline: deadline || null, account: accountId }] }));
    setName(""); setTarget(""); setDeadline("");
  };
  const removeGoal = (id) => updateUser((prev) => ({ ...prev, goals: prev.goals.filter((g) => g.id !== id) }));

  const contribute = (goal, sign) => {
    const v = toMinor(amt[goal.id]);
    if (v <= 0) return;
    const amountMinor = sign * v;
    updateUser((prev) => ({
      ...prev,
      transactions: [{ id: uid(), type: sign > 0 ? "expense" : "income", amountMinor: v, description: `${sign > 0 ? "Contribution" : "Withdrawal"}: ${goal.name}`, category: "Savings", currency: prev.settings.baseCurrency, date: todayISO(), account: goal.account, goalId: goal.id, tags: [], notes: "", createdAt: nowISO() }, ...prev.transactions],
    }));
    setAmt({ ...amt, [goal.id]: "" });
  };

  return (
    <div>
      <h1 style={styles.pageTitle}>Savings goals</h1>
      <div style={styles.twoCol}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}><Target size={15} style={{ verticalAlign: -2 }} /> New goal</h2>
          <div style={styles.form}>
            <input style={styles.input} placeholder="Goal name" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={styles.input} type="number" placeholder="Target amount" value={target} onChange={(e) => setTarget(e.target.value)} />
            <input style={styles.input} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <select style={styles.input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {userData.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button style={styles.primaryBtn} onClick={addGoal}><Plus size={15} /> Create goal</button>
          </div>
        </div>

        <div style={{ ...styles.card, gridColumn: userData.goals.length ? "1 / -1" : undefined }}>
          <h2 style={styles.cardTitle}>Your goals</h2>
          {userData.goals.length === 0 ? <EmptyState text="No goals yet — create one to start tracking progress." /> : (
            <div style={styles.goalGrid}>
              {userData.goals.map((g) => {
                const saved = contributions[g.id] || 0;
                const pct = g.targetMinor > 0 ? Math.min(100, (saved / g.targetMinor) * 100) : 0;
                const remaining = Math.max(0, g.targetMinor - saved);
                const monthlyNeeded = g.deadline ? Math.ceil(fromMinor(remaining) / monthsBetween(todayISO(), g.deadline)) : null;
                return (
                  <div key={g.id} style={styles.goalCard}>
                    <div style={styles.goalTop}>
                      <span style={styles.goalName}>{g.name}</span>
                      <button style={styles.iconBtn} onClick={() => removeGoal(g.id)}><Trash2 size={13} /></button>
                    </div>
                    <div style={styles.budgetBarTrack}><div style={{ ...styles.budgetBarFill, width: `${pct}%`, background: "#3E8E7E" }} /></div>
                    <div style={styles.budgetFoot}><span>{money(saved)} of {money(g.targetMinor)}</span><span>{pct.toFixed(0)}%</span></div>
                    {g.deadline && (
                      <div style={styles.goalDeadline}>
                        <History size={11} /> by {g.deadline}{monthlyNeeded !== null && ` · ~${money(toMinor(monthlyNeeded))}/mo needed`}
                      </div>
                    )}
                    <div style={styles.formRow}>
                      <input style={styles.input} type="number" placeholder="Amount" value={amt[g.id] || ""} onChange={(e) => setAmt({ ...amt, [g.id]: e.target.value })} />
                      <button style={styles.secondarySubmitBtn} onClick={() => contribute(g, 1)}>Add</button>
                      <button style={styles.secondarySubmitBtnAlt} onClick={() => contribute(g, -1)}>Withdraw</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   GROUPS
   ============================================================ */
const AVATAR_COLORS = ["#C4436B", "#4FB88F", "#5B7C99", "#D9A441", "#7A6FA6", "#E15B64", "#3E8E7E", "#8C6E4C"];
const colorFor = (name) => AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (name) => name.trim().slice(0, 2).toUpperCase();

// net[m] > 0 => owed to them. net[m] < 0 => they owe. All in minor units.
function computeGroupBalances(members, expenses, settlements) {
  const net = {}; members.forEach((m) => (net[m] = 0));
  expenses.forEach((e) => {
    net[e.paidBy] = (net[e.paidBy] || 0) + e.amountMinor;
    e.splitAmong.forEach((m) => {
      const share = e.splitType === "equal" || !e.splitDetails
        ? Math.round(e.amountMinor / e.splitAmong.length)
        : (e.splitDetails[m] || 0);
      net[m] = (net[m] || 0) - share;
    });
  });
  (settlements || []).forEach((s) => { net[s.from] = (net[s.from] || 0) + s.amountMinor; net[s.to] = (net[s.to] || 0) - s.amountMinor; });
  const creditors = Object.entries(net).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v]);
  const debtors = Object.entries(net).filter(([, v]) => v < -1).sort((a, b) => a[1] - b[1]).map(([n, v]) => [n, v]);
  const suggested = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(-debtors[i][1], creditors[j][1]);
    if (amt > 1) suggested.push({ from: debtors[i][0], to: creditors[j][0], amountMinor: amt });
    debtors[i][1] += amt; creditors[j][1] -= amt;
    if (Math.abs(debtors[i][1]) < 1) i++;
    if (Math.abs(creditors[j][1]) < 1) j++;
  }
  return { net, suggested };
}

function GroupsRouter({ ctx }) {
  return ctx.activeGroupId ? <GroupDetailView ctx={ctx} /> : <GroupsListView ctx={ctx} />;
}

function GroupsListView({ ctx }) {
  const { userData, updateUser, groupsData, setActiveGroupId, addToast } = ctx;
  const [showNew, setShowNew] = useState(false);

  const createGroup = async (name, description, currency, members) => {
    const id = uid();
    const g = emptyGroup(id, name, description, currency, Array.from(new Set([userData.name, ...members])));
    await saveGroup(id, g);
    ctx.updateGroup(id, g);
    updateUser((prev) => ({ ...prev, groups: [...prev.groups, { id, name }] }));
    addToast("success", "Group created");
    setActiveGroupId(id);
  };

  return (
    <div>
      <div style={styles.rowHead}>
        <h1 style={styles.pageTitle}>Groups</h1>
        <button style={styles.primaryBtn} onClick={() => setShowNew(true)}><Plus size={15} /> New group</button>
      </div>
      {userData.groups.length === 0 ? (
        <EmptyState text="No groups yet — start one to split your first bill." />
      ) : (
        <div style={styles.groupGrid}>
          {userData.groups.map((g) => {
            const gd = groupsData[g.id];
            const { net } = gd ? computeGroupBalances(gd.members, gd.expenses, gd.settlements) : { net: {} };
            const mine = net[userData.name] || 0;
            return (
              <div key={g.id} style={styles.groupCard} onClick={() => setActiveGroupId(g.id)}>
                <Receipt size={18} color="#C4436B" />
                <div style={{ flex: 1 }}>
                  <div style={styles.groupCardName}>{g.name}</div>
                  {gd && <div style={{ fontSize: 11.5, color: mine > 0 ? "#4FB88F" : mine < 0 ? "#C4436B" : "#9A94A0" }}>
                    {mine > 1 ? `you're owed ${money(mine, gd.currency)}` : mine < -1 ? `you owe ${money(-mine, gd.currency)}` : "settled up"}
                  </div>}
                </div>
                <ArrowRight size={16} color="#B7A8BC" />
              </div>
            );
          })}
        </div>
      )}
      {showNew && <NewGroupModal onClose={() => setShowNew(false)} onCreate={createGroup} />}
    </div>
  );
}

function NewGroupModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [memberInput, setMemberInput] = useState("");
  const [members, setMembers] = useState([]);
  const addMember = () => { if (memberInput.trim()) { setMembers([...members, memberInput.trim()]); setMemberInput(""); } };
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeadRow}><h2 style={styles.modalTitle}>New group</h2><button style={styles.iconBtn} onClick={onClose}><X size={16} /></button></div>
        <div style={styles.form}>
          <input style={styles.input} placeholder="Group name (e.g. Goa Trip)" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={styles.input} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select style={styles.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c} — {CURRENCIES[c].label}</option>)}
          </select>
          <div style={styles.formRow}>
            <input style={styles.input} placeholder="Add a friend's name" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} />
            <button style={styles.secondaryBtn} onClick={addMember}>Add</button>
          </div>
          <div style={styles.chipRow}>{members.map((m, i) => <span key={i} style={styles.chip}>{m}</span>)}</div>
          <button style={{ ...styles.primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }}
            onClick={() => name.trim() && onCreate(name.trim(), description, currency, members)}>Create group</button>
        </div>
      </div>
    </div>
  );
}

function GroupDetailView({ ctx }) {
  const { activeGroupId, groupsData, setActiveGroupId, userData, updateGroup, addToast } = ctx;
  const group = groupsData[activeGroupId];
  const [tab, setTab] = useState("expenses");
  if (!group) return <div style={styles.card}><EmptyState text="Loading group…" /></div>;

  const { net, suggested } = computeGroupBalances(group.members, group.expenses, group.settlements);

  const removeExpense = (id) => updateGroup(group.id, (g) => ({ ...g, expenses: g.expenses.filter((e) => e.id !== id) }));
  const recordSettlement = (from, to, amountMinor, note, method) => {
    updateGroup(group.id, (g) => ({ ...g, settlements: [{ id: uid(), from, to, amountMinor, date: todayISO(), note: note || "", method: method || "Other" }, ...g.settlements] }));
    addToast("success", "Settlement recorded");
  };
  const addRule = (rule) => updateGroup(group.id, (g) => ({ ...g, recurringRules: [...g.recurringRules, { ...rule, id: uid(), active: true }] }));
  const removeRule = (id) => updateGroup(group.id, (g) => ({ ...g, recurringRules: g.recurringRules.filter((r) => r.id !== id) }));
  const addMember = (name) => updateGroup(group.id, (g) => ({ ...g, members: Array.from(new Set([...g.members, name])) }));
  const removeMember = (name) => updateGroup(group.id, (g) => ({ ...g, members: g.members.filter((m) => m !== name) }));

  return (
    <div>
      <button style={styles.backBtn} onClick={() => setActiveGroupId(null)}>← All groups</button>
      <h1 style={styles.pageTitle}>{group.name}</h1>
      {group.description && <p style={{ fontSize: 12.5, color: "#8A8492", marginTop: -10 }}>{group.description}</p>}
      <div style={styles.avatarRow}>
        {group.members.map((m) => (
          <div key={m} style={styles.avatarWrap}><div style={{ ...styles.avatar, background: colorFor(m) }}>{initials(m)}</div><span style={styles.avatarName}>{m}</span></div>
        ))}
      </div>
      <div style={styles.tabs}>
        {[["expenses", "Expenses"], ["members", "Members"], ["balances", "Balances"], ["recurring", "Recurring"], ["insights", "Insights"]].map(([k, label]) => (
          <button key={k} style={{ ...styles.tab, ...(tab === k ? styles.tabActive : {}) }} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "expenses" && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Expense history</h2>
          {group.expenses.length === 0 ? <EmptyState text="No expenses logged yet. Use Add Transaction → Group to log one." /> : (
            <div style={styles.expenseList}>
              {group.expenses.map((e) => (
                <div key={e.id} style={styles.expenseRow}>
                  <div style={{ ...styles.avatar, width: 30, height: 30, fontSize: 11, background: colorFor(e.paidBy) }}>{initials(e.paidBy)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.expenseTitle}>{e.description} {e.fromRule && <Repeat size={11} style={{ verticalAlign: -1, marginLeft: 4, opacity: 0.5 }} />}</div>
                    <div style={styles.expenseSub}>{e.paidBy} paid · {e.splitType === "equal" || !e.splitType ? `split ${e.splitAmong.length} ways` : e.splitType === "percentage" ? "split by %" : "split exact"}{e.category ? ` · ${e.category}` : ""}</div>
                  </div>
                  <div style={styles.expenseAmount}>{money(e.amountMinor, group.currency)}</div>
                  <button style={styles.iconBtn} onClick={() => removeExpense(e.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "members" && <GroupMembersTab group={group} onAdd={addMember} onRemove={removeMember} />}

      {tab === "balances" && (
        <GroupBalancesTab group={group} net={net} suggested={suggested} onSettle={recordSettlement} />
      )}

      {tab === "recurring" && <GroupRecurringTab group={group} onAdd={addRule} onRemove={removeRule} categories={userData.settings.categories} />}

      {tab === "insights" && <GroupInsightsTab group={group} />}
    </div>
  );
}

function GroupMembersTab({ group, onAdd, onRemove }) {
  const [name, setName] = useState("");
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Members</h2>
      <div style={styles.formRow}>
        <input style={styles.input} placeholder="Add a member by name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && (onAdd(name.trim()), setName(""))} />
        <button style={styles.secondaryBtn} onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); } }}>Add</button>
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {group.members.map((m) => (
          <div key={m} style={styles.memberRow}>
            <div style={{ ...styles.avatar, width: 28, height: 28, fontSize: 11, background: colorFor(m) }}>{initials(m)}</div>
            <span style={{ flex: 1, fontSize: 13 }}>{m}</span>
            <button style={styles.iconBtn} onClick={() => onRemove(m)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupBalancesTab({ group, net, suggested, onSettle }) {
  const [note, setNote] = useState({});
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Net position</h2>
      <div style={styles.netGrid}>
        {group.members.map((m) => (
          <div key={m} style={styles.netRow}>
            <div style={{ ...styles.avatar, width: 26, height: 26, fontSize: 10, background: colorFor(m) }}>{initials(m)}</div>
            <span style={{ flex: 1 }}>{m}</span>
            <span style={{ color: net[m] > 1 ? "#4FB88F" : net[m] < -1 ? "#C4436B" : "#9A94A0", fontFamily: "monospace", fontWeight: 600 }}>
              {net[m] > 1 ? "gets back " : net[m] < -1 ? "owes " : "settled "}{Math.abs(net[m]) > 1 ? money(Math.abs(net[m]), group.currency) : ""}
            </span>
          </div>
        ))}
      </div>
      <h2 style={{ ...styles.cardTitle, marginTop: 20 }}>Suggested settlements</h2>
      {suggested.length === 0 ? <EmptyState text="Everyone's square." /> : (
        <div style={styles.settleList}>
          {suggested.map((s, i) => (
            <div key={i} style={styles.settleRow}>
              <span style={styles.settleName}>{s.from}</span><ArrowRight size={15} color="#B7A8BC" /><span style={styles.settleName}>{s.to}</span>
              <span style={styles.settleAmt}>{money(s.amountMinor, group.currency)}</span>
              <button style={styles.settleBtn} onClick={() => onSettle(s.from, s.to, s.amountMinor, note[i], "Other")}><Check size={13} /> Mark paid</button>
            </div>
          ))}
        </div>
      )}
      <h2 style={{ ...styles.cardTitle, marginTop: 20 }}><History size={14} style={{ verticalAlign: -2 }} /> Settlement history</h2>
      {group.settlements.length === 0 ? <EmptyState text="No payments recorded yet." /> : (
        <div style={styles.settleList}>
          {group.settlements.map((s) => (
            <div key={s.id} style={{ ...styles.settleRow, background: "#F7F2F6" }}>
              <span style={styles.settleName}>{s.from}</span><ArrowRight size={15} color="#B7A8BC" /><span style={styles.settleName}>{s.to}</span>
              <span style={styles.settleAmt}>{money(s.amountMinor, group.currency)}</span>
              <span style={{ fontSize: 11, color: "#9A94A0" }}>{s.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRecurringTab({ group, onAdd, onRemove, categories }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [paidBy, setPaidBy] = useState(group.members[0]);
  const [splitAmong, setSplitAmong] = useState(group.members);
  const [freq, setFreq] = useState("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const toggle = (m) => setSplitAmong((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  const submit = () => {
    const amt = toMinor(amount);
    if (amt <= 0 || !description.trim() || splitAmong.length === 0) return;
    onAdd({ description: description.trim(), amountMinor: amt, paidBy, splitAmong, splitType: "equal", splitDetails: null, category, freq, nextDate: startDate, endDate: null });
    setDescription(""); setAmount("");
  };
  return (
    <div style={styles.twoCol}>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}><Repeat size={15} style={{ verticalAlign: -2 }} /> New recurring bill</h2>
        <div style={styles.form}>
          <input style={styles.input} placeholder="e.g. Apartment rent" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div style={styles.formRow}>
            <input style={styles.input} type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select style={styles.input} value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </div>
          <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <label style={styles.label}>Paid by</label>
          <select style={styles.input} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{group.members.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <label style={styles.label}>Split among</label>
          <div style={styles.chipRow}>{group.members.map((m) => <button key={m} type="button" onClick={() => toggle(m)} style={{ ...styles.chip, border: "none", cursor: "pointer", ...(splitAmong.includes(m) ? styles.chipActive : {}) }}>{m}</button>)}</div>
          <label style={styles.label}>Starts on</label>
          <input style={styles.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <button style={{ ...styles.primaryBtn, justifyContent: "center", marginTop: 6 }} onClick={submit}><Plus size={15} /> Add recurring bill</button>
        </div>
      </div>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Active recurring bills</h2>
        {group.recurringRules.length === 0 ? <EmptyState text="None set up yet." /> : (
          <div style={styles.expenseList}>
            {group.recurringRules.map((r) => (
              <div key={r.id} style={styles.expenseRow}>
                <div style={{ flex: 1 }}><div style={styles.expenseTitle}>{r.description}</div><div style={styles.expenseSub}>{r.paidBy} pays · {r.freq} · next {r.nextDate}</div></div>
                <div style={styles.expenseAmount}>{money(r.amountMinor, group.currency)}</div>
                <button style={styles.iconBtn} onClick={() => onRemove(r.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupInsightsTab({ group }) {
  const byCategory = useMemo(() => {
    const m = {};
    group.expenses.forEach((e) => { const c = e.category || "Other"; m[c] = (m[c] || 0) + e.amountMinor; });
    return Object.entries(m).map(([name, value]) => ({ name, value: fromMinor(value) }));
  }, [group.expenses]);
  const byMember = useMemo(() => {
    const m = {};
    group.members.forEach((mem) => (m[mem] = 0));
    group.expenses.forEach((e) => { m[e.paidBy] = (m[e.paidBy] || 0) + e.amountMinor; });
    return Object.entries(m).map(([name, value]) => ({ name, value: fromMinor(value) }));
  }, [group.expenses, group.members]);
  const total = group.expenses.reduce((s, e) => s + e.amountMinor, 0);

  return (
    <div style={styles.twoCol}>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Total group spending</h2>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 30 }}>{money(total, group.currency)}</div>
      </div>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>By category</h2>
        {byCategory.length === 0 ? <EmptyState text="No expenses yet." /> : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={40} outerRadius={78} paddingAngle={2}>
                {byCategory.map((entry, i) => <Cell key={i} fill={catColor(entry.name)} />)}
              </Pie>
              <Tooltip formatter={(v) => money(toMinor(v), group.currency)} contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
        <h2 style={styles.cardTitle}>By member (amount paid)</h2>
        {byMember.every((m) => m.value === 0) ? <EmptyState text="No expenses yet." /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byMember}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEE7" />
              <XAxis dataKey="name" tick={{ fontFamily: "Inter", fontSize: 12 }} />
              <YAxis tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} />
              <Tooltip formatter={(v) => money(toMinor(v), group.currency)} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {byMember.map((entry, i) => <Cell key={i} fill={colorFor(entry.name)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

const tooltipStyle = { fontFamily: "Inter", fontSize: 12, borderRadius: 8, border: "1px solid #DCE0D3" };

/* ============================================================
   RECURRING VIEW (personal)
   ============================================================ */
function RecurringView({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const [type, setType] = useState("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(userData.settings.categories[0]);
  const [account, setAccount] = useState(userData.accounts[0]?.id || "");
  const [freq, setFreq] = useState("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");

  const submit = () => {
    const amt = toMinor(amount);
    if (amt <= 0 || !description.trim()) { addToast("error", "Add a description and amount."); return; }
    updateUser((prev) => ({
      ...prev,
      recurringRules: [...prev.recurringRules, { id: uid(), type, amountMinor: amt, description: description.trim(), category, account, currency: prev.settings.baseCurrency, tags: [], freq, nextDate: startDate, endDate: endDate || null, active: true }],
    }));
    setDescription(""); setAmount("");
    addToast("success", "Recurring rule created");
  };
  const removeRule = (id) => updateUser((prev) => ({ ...prev, recurringRules: prev.recurringRules.filter((r) => r.id !== id) }));
  const toggleActive = (id) => updateUser((prev) => ({ ...prev, recurringRules: prev.recurringRules.map((r) => r.id === id ? { ...r, active: !r.active } : r) }));

  const upcoming = useMemo(() => [...userData.recurringRules].filter((r) => r.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate)), [userData.recurringRules]);

  // subscription detection: same description + similar amount, 2+ times, roughly monthly gaps
  const detectedSubs = useMemo(() => {
    const groupsMap = {};
    userData.transactions.filter((t) => t.type === "expense" && !t.fromRule).forEach((t) => {
      const key = t.description.trim().toLowerCase();
      (groupsMap[key] = groupsMap[key] || []).push(t);
    });
    const already = new Set(userData.recurringRules.map((r) => r.description.trim().toLowerCase()));
    const dismissed = new Set(userData.dismissedNudges || []);
    return Object.entries(groupsMap)
      .filter(([key, list]) => list.length >= 2 && !already.has(key) && !dismissed.has(key))
      .map(([key, list]) => {
        const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) gaps.push((new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000);
        const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        if (avgGap < 20 || avgGap > 40) return null;
        const avgAmount = Math.round(sorted.reduce((s, t) => s + t.amountMinor, 0) / sorted.length);
        return { key, description: sorted[0].description, amountMinor: avgAmount, category: sorted[0].category, account: sorted[0].account, last: sorted[sorted.length - 1].date };
      }).filter(Boolean);
  }, [userData.transactions, userData.recurringRules, userData.dismissedNudges]);

  const convertSub = (s) => {
    updateUser((prev) => ({
      ...prev,
      recurringRules: [...prev.recurringRules, { id: uid(), type: "expense", amountMinor: s.amountMinor, description: s.description, category: s.category, account: s.account, currency: prev.settings.baseCurrency, tags: [], freq: "monthly", nextDate: addInterval(s.last, "monthly"), endDate: null, active: true }],
    }));
    addToast("success", `${s.description} converted to recurring`);
  };
  const dismissSub = (key) => updateUser((prev) => ({ ...prev, dismissedNudges: [...(prev.dismissedNudges || []), key] }));

  return (
    <div>
      <h1 style={styles.pageTitle}>Recurring</h1>

      {detectedSubs.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}><RefreshCw size={14} style={{ verticalAlign: -2 }} /> Looks like a subscription</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {detectedSubs.map((s) => (
              <div key={s.key} style={styles.subRow}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.description}</div>
                  <div style={{ fontSize: 11, color: "#9A9587" }}>~{money(s.amountMinor)} · roughly monthly · last on {s.last}</div>
                </div>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button style={styles.miniAcceptBtn} onClick={() => convertSub(s)}><Check size={12} /> Make recurring</button>
                  <button style={styles.miniRejectBtn} onClick={() => dismissSub(s.key)}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={styles.twoCol}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}><Repeat size={15} style={{ verticalAlign: -2 }} /> New recurring transaction</h2>
          <div style={styles.form}>
            <div style={styles.typeToggle}>
              <button onClick={() => setType("expense")} style={{ ...styles.typeBtn, ...(type === "expense" ? { background: "#B5533C", color: "#fff", borderColor: "#B5533C" } : {}) }}>Expense</button>
              <button onClick={() => setType("income")} style={{ ...styles.typeBtn, ...(type === "income" ? { background: "#2F6F62", color: "#fff", borderColor: "#2F6F62" } : {}) }}>Income</button>
            </div>
            <input style={styles.input} placeholder="Description (e.g. Rent, Salary)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div style={styles.formRow}>
              <input style={styles.input} type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select style={styles.input} value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</select>
            </div>
            <div style={styles.formRow}>
              <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>{userData.settings.categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select style={styles.input} value={account} onChange={(e) => setAccount(e.target.value)}>{userData.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
            <label style={styles.label}>Starts</label>
            <input style={styles.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <label style={styles.label}>Ends (optional)</label>
            <input style={styles.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <button style={{ ...styles.primaryBtn, justifyContent: "center", marginTop: 4 }} onClick={submit}><Plus size={15} /> Add rule</button>
          </div>
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>All rules</h2>
          {userData.recurringRules.length === 0 ? <EmptyState text="No recurring transactions set up." /> : (
            <div style={styles.expenseList}>
              {[...userData.recurringRules].sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map((r) => (
                <div key={r.id} style={{ ...styles.expenseRow, opacity: r.active ? 1 : 0.45 }}>
                  <div style={{ flex: 1 }}>
                    <div style={styles.expenseTitle}>{r.description}</div>
                    <div style={styles.expenseSub}>{r.freq} · next {r.nextDate}{r.endDate ? ` · ends ${r.endDate}` : ""}</div>
                  </div>
                  <span style={{ fontFamily: "IBM Plex Mono", fontSize: 13, color: txnColor(r.type) }}>{txnSign(r.type)}{money(r.amountMinor, r.currency)}</span>
                  <button style={styles.miniToggleBtn} onClick={() => toggleActive(r.id)}>{r.active ? "Pause" : "Resume"}</button>
                  <button style={styles.iconBtn} onClick={() => removeRule(r.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   INSIGHTS VIEW (personal)
   ============================================================ */
const RANGES = [
  { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "lastMonth", label: "Last month" },
  { key: "3months", label: "Last 3 months" }, { key: "year", label: "This year" }, { key: "custom", label: "Custom" },
];
function rangeToDates(rangeKey, custom) {
  const now = new Date();
  if (rangeKey === "custom") return custom;
  if (rangeKey === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return { start: d.toISOString().slice(0, 10), end: todayISO() }; }
  if (rangeKey === "month") return { start: `${now.toISOString().slice(0, 7)}-01`, end: todayISO() };
  if (rangeKey === "lastMonth") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endD = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: d.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10) };
  }
  if (rangeKey === "3months") { const d = new Date(now); d.setMonth(d.getMonth() - 3); return { start: d.toISOString().slice(0, 10), end: todayISO() }; }
  if (rangeKey === "year") return { start: `${now.getFullYear()}-01-01`, end: todayISO() };
  return { start: "2000-01-01", end: todayISO() };
}

function InsightsView({ ctx }) {
  const { userData } = ctx;
  const [rangeKey, setRangeKey] = useState("month");
  const [custom, setCustom] = useState({ start: todayISO(), end: todayISO() });
  const { start, end } = rangeToDates(rangeKey, custom);

  const inRange = useMemo(() => userData.transactions.filter((t) => t.date >= start && t.date <= end), [userData.transactions, start, end]);
  const expenses = inRange.filter((t) => t.type === "expense");
  const income = inRange.filter((t) => t.type === "income");
  const totalExpense = expenses.reduce((s, t) => s + t.amountMinor, 0);
  const totalIncome = income.reduce((s, t) => s + t.amountMinor, 0);
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null;

  const byCategory = useMemo(() => {
    const m = {};
    expenses.forEach((t) => { m[t.category] = (m[t.category] || 0) + t.amountMinor; });
    return Object.entries(m).map(([name, value]) => ({ name, value: fromMinor(value) })).sort((a, b) => b.value - a.value);
  }, [expenses]);

  const overTime = useMemo(() => {
    const m = {};
    inRange.forEach((t) => {
      const k = t.date;
      if (!m[k]) m[k] = { date: k, income: 0, expense: 0 };
      if (t.type === "income" || t.type === "refund") m[k].income += fromMinor(t.amountMinor);
      else if (t.type === "expense") m[k].expense += fromMinor(t.amountMinor);
    });
    return Object.values(m).sort((a, b) => a.date.localeCompare(b.date));
  }, [inRange]);

  const largest = useMemo(() => [...expenses].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5), [expenses]);

  // month-over-month
  const thisMonthKey = todayISO().slice(0, 7);
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = prevMonthDate.toISOString().slice(0, 7);
  const thisMonthSpend = userData.transactions.filter((t) => t.type === "expense" && t.date.slice(0, 7) === thisMonthKey).reduce((s, t) => s + t.amountMinor, 0);
  const prevMonthSpend = userData.transactions.filter((t) => t.type === "expense" && t.date.slice(0, 7) === prevMonthKey).reduce((s, t) => s + t.amountMinor, 0);
  const momChange = prevMonthSpend > 0 ? ((thisMonthSpend - prevMonthSpend) / prevMonthSpend) * 100 : null;

  // anomaly detection: this month's category spend vs avg of prior 3 months
  const anomalies = useMemo(() => {
    const results = [];
    userData.settings.categories.forEach((cat) => {
      const monthTotals = {};
      userData.transactions.filter((t) => t.type === "expense" && t.category === cat).forEach((t) => {
        const mk = t.date.slice(0, 7);
        monthTotals[mk] = (monthTotals[mk] || 0) + t.amountMinor;
      });
      const cur = monthTotals[thisMonthKey] || 0;
      const priorKeys = Object.keys(monthTotals).filter((k) => k !== thisMonthKey).sort().slice(-3);
      if (priorKeys.length < 2 || cur === 0) return;
      const avg = priorKeys.reduce((s, k) => s + monthTotals[k], 0) / priorKeys.length;
      if (avg > 0 && cur > avg * 1.5) results.push({ cat, cur, avg, pct: Math.round(((cur - avg) / avg) * 100) });
    });
    return results;
  }, [userData.transactions, userData.settings.categories, thisMonthKey]);

  // cash-flow forecast: recurring income/expense over next 30 days + current balance
  const forecast30 = useMemo(() => {
    const bal = totalNetWorth(userData);
    let projected = bal;
    userData.recurringRules.filter((r) => r.active).forEach((r) => {
      let d = r.nextDate;
      const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
      let guard = 0;
      while (new Date(d) <= horizon && guard < 60) {
        projected += r.type === "income" ? r.amountMinor : r.type === "expense" ? -r.amountMinor : 0;
        d = addInterval(d, r.freq); guard++;
      }
    });
    return { current: bal, projected };
  }, [userData]);

  return (
    <div>
      <div style={styles.rowHead}>
        <h1 style={styles.pageTitle}>Insights</h1>
        <select style={styles.filterSelect} value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>
      {rangeKey === "custom" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={styles.input} type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
          <input style={styles.input} type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
        </div>
      )}

      <div style={styles.statGrid}>
        <StatCard label="Income" value={money(totalIncome)} color="#2F6F62" />
        <StatCard label="Expenses" value={money(totalExpense)} color="#B5533C" />
        <StatCard label="Savings rate" value={savingsRate === null ? "—" : `${savingsRate.toFixed(0)}%`} color="#5B7C99" />
        <StatCard label="Vs. last month" value={momChange === null ? "—" : `${momChange > 0 ? "+" : ""}${momChange.toFixed(0)}%`} color={momChange > 0 ? "#B5533C" : "#2F6F62"} />
      </div>

      {anomalies.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Worth a look</h2>
          {anomalies.map((a) => (
            <div key={a.cat} style={{ fontSize: 12.5, color: "#6B695E", marginBottom: 4 }}>
              Your <b>{a.cat}</b> spending this month ({money(a.cur)}) is running about {a.pct}% above your recent {money(toMinor(a.avg / 100))} average — estimate, not a guarantee of anything unusual.
            </div>
          ))}
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.cardTitle}><TrendingUp size={14} style={{ verticalAlign: -2 }} /> 30-day cash-flow estimate</h2>
        <p style={{ fontSize: 12, color: "#9A9587", marginTop: -6 }}>Based only on your active recurring rules — an estimate, not a guarantee.</p>
        <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
          <div><div style={{ fontSize: 11, color: "#9A9587" }}>Current</div><div style={{ fontFamily: "IBM Plex Mono", fontSize: 18 }}>{money(forecast30.current)}</div></div>
          <div><div style={{ fontSize: 11, color: "#9A9587" }}>In 30 days (est.)</div><div style={{ fontFamily: "IBM Plex Mono", fontSize: 18, color: forecast30.projected >= forecast30.current ? "#2F6F62" : "#B5533C" }}>{money(forecast30.projected)}</div></div>
        </div>
      </div>

      <div style={styles.twoCol}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Spending by category</h2>
          {byCategory.length === 0 ? <EmptyState text="No expenses in this range." /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {byCategory.map((entry, i) => <Cell key={i} fill={catColor(entry.name)} />)}
                </Pie>
                <Tooltip formatter={(v) => money(toMinor(v))} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontFamily: "Inter", fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Largest expenses</h2>
          {largest.length === 0 ? <EmptyState text="No expenses in this range." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {largest.map((t) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #EDEBDF" }}>
                  <span>{t.description} <span style={{ color: "#9A9587" }}>· {t.date}</span></span>
                  <span style={{ fontFamily: "IBM Plex Mono", color: "#B5533C" }}>{money(t.amountMinor, t.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <h2 style={styles.cardTitle}>Income vs. expense over time</h2>
          {overTime.length === 0 ? <EmptyState text="Nothing in this range yet." /> : (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={overTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3E0D5" />
                <XAxis dataKey="date" tick={{ fontFamily: "IBM Plex Mono", fontSize: 10 }} />
                <YAxis tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} />
                <Tooltip formatter={(v) => money(toMinor(v))} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontFamily: "Inter", fontSize: 12 }} />
                <Line type="monotone" dataKey="income" stroke="#2F6F62" strokeWidth={2} dot={false} name="Income" />
                <Line type="monotone" dataKey="expense" stroke="#B5533C" strokeWidth={2} dot={false} name="Expense" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
function StatCard({ label, value, color }) {
  return <div style={styles.statCard}><div style={{ fontSize: 11, color: "#9A9587" }}>{label}</div><div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 20, color }}>{value}</div></div>;
}

/* ============================================================
   SETTLEMENTS VIEW — aggregated across all groups
   ============================================================ */
function SettlementsView({ ctx }) {
  const { userData, updateUser, groupsData, updateGroup, addToast } = ctx;
  const groups = userData.groups.map((g) => groupsData[g.id]).filter(Boolean);

  let totalOwedToMe = 0, totalIOwe = 0;
  const rows = [];
  groups.forEach((g) => {
    const { net, suggested } = computeGroupBalances(g.members, g.expenses, g.settlements);
    const mine = net[userData.name] || 0;
    if (mine > 1) totalOwedToMe += mine; else if (mine < -1) totalIOwe += -mine;
    suggested.filter((s) => s.from === userData.name || s.to === userData.name).forEach((s) => rows.push({ ...s, groupId: g.id, groupName: g.name, currency: g.currency }));
  });
  userData.debts.filter((d) => !d.settled).forEach((d) => {
    if (d.direction === "owed_to_me") totalOwedToMe += d.amountMinor; else totalIOwe += d.amountMinor;
  });

  const allHistory = groups.flatMap((g) => g.settlements.map((s) => ({ ...s, groupName: g.name, currency: g.currency }))).sort((a, b) => b.date.localeCompare(a.date));

  const settle = (row) => {
    updateGroup(row.groupId, (g) => ({ ...g, settlements: [{ id: uid(), from: row.from, to: row.to, amountMinor: row.amountMinor, date: todayISO(), note: "", method: "Other" }, ...g.settlements] }));
    addToast("success", "Settlement recorded");
  };
  const settleDebt = (id) => updateUser((prev) => ({ ...prev, debts: prev.debts.map((d) => d.id === id ? { ...d, settled: true } : d) }));

  return (
    <div>
      <h1 style={styles.pageTitle}>Settlements</h1>
      <div style={styles.statGrid}>
        <StatCard label="You are owed" value={money(totalOwedToMe)} color="#4FB88F" />
        <StatCard label="You owe" value={money(totalIOwe)} color="#C4436B" />
        <StatCard label="Net position" value={money(totalOwedToMe - totalIOwe)} color={totalOwedToMe - totalIOwe >= 0 ? "#4FB88F" : "#C4436B"} />
      </div>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Pending, across all groups</h2>
        {rows.length === 0 ? <EmptyState text="Nothing pending — you're settled up everywhere." /> : (
          <div style={styles.settleList}>
            {rows.map((s, i) => (
              <div key={i} style={styles.settleRow}>
                <span style={{ fontSize: 11, color: "#9A94A0", width: 90 }}>{s.groupName}</span>
                <span style={styles.settleName}>{s.from}</span><ArrowRight size={15} color="#B7A8BC" /><span style={styles.settleName}>{s.to}</span>
                <span style={styles.settleAmt}>{money(s.amountMinor, s.currency)}</span>
                <button style={styles.settleBtn} onClick={() => settle(s)}><Check size={13} /> Mark paid</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}><HandCoins size={14} style={{ verticalAlign: -2 }} /> Personal IOUs</h2>
        {userData.debts.filter((d) => !d.settled).length === 0 ? <EmptyState text="No open IOUs — log one from Add Transaction → Debt / IOU." /> : (
          <div style={styles.settleList}>
            {userData.debts.filter((d) => !d.settled).map((d) => (
              <div key={d.id} style={styles.settleRow}>
                <span style={styles.settleName}>{d.direction === "owed_to_me" ? d.person : userData.name}</span>
                <ArrowRight size={15} color="#B7A8BC" />
                <span style={styles.settleName}>{d.direction === "owed_to_me" ? userData.name : d.person}</span>
                <span style={styles.settleAmt}>{money(d.amountMinor, d.currency)}</span>
                <button style={styles.settleBtn} onClick={() => settleDebt(d.id)}><Check size={13} /> Mark settled</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}><History size={14} style={{ verticalAlign: -2 }} /> History, across all groups</h2>
        {allHistory.length === 0 ? <EmptyState text="No settlements recorded yet." /> : (
          <div style={styles.settleList}>
            {allHistory.map((s) => (
              <div key={s.id} style={{ ...styles.settleRow, background: "#FBFAF6" }}>
                <span style={{ fontSize: 11, color: "#9A94A0", width: 90 }}>{s.groupName}</span>
                <span style={styles.settleName}>{s.from}</span><ArrowRight size={15} color="#B7A8BC" /><span style={styles.settleName}>{s.to}</span>
                <span style={styles.settleAmt}>{money(s.amountMinor, s.currency)}</span>
                <span style={{ fontSize: 11, color: "#9A94A0" }}>{s.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SETTINGS VIEW
   ============================================================ */
function csvEscape(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }

function transactionsToCSV(txns, accountsById) {
  const header = ["Date", "Description", "Amount", "Type", "Category", "Account", "Currency", "Tags", "Notes"].join(",");
  const rows = txns.map((t) => [
    t.date, csvEscape(t.description), fromMinor(t.amountMinor), t.type, t.category || "",
    accountsById[t.account]?.name || "", t.currency || "", csvEscape((t.tags || []).join("|")), csvEscape(t.notes || ""),
  ].join(","));
  return [header, ...rows].join("\n");
}

function downloadText(filename, text, mime = "text/csv") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  // lightweight CSV parser (handles quoted fields) — avoids an extra bundle dependency
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; } if (c === "\r" && next === "\n") i++; }
      else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
  return { headers, records };
}

const REQUIRED_FIELDS = ["date", "description", "amount", "type"];
const OPTIONAL_FIELDS = ["category", "account", "tags", "notes"];
function guessMapping(headers) {
  const map = {};
  [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].forEach((f) => {
    const hit = headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === f);
    if (hit) map[f] = hit;
  });
  return map;
}

function SettingsView({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const [tab, setTab] = useState("accounts");
  return (
    <div>
      <h1 style={styles.pageTitle}>Settings</h1>
      <div style={styles.tabs}>
        {[["accounts", "Accounts"], ["categories", "Categories"], ["currency", "Currency"], ["ai", "AI"], ["data", "Import / Export"], ["activity", "Activity log"], ["demo", "Demo & privacy"]].map(([k, label]) => (
          <button key={k} style={{ ...styles.tab, ...(tab === k ? styles.tabActive : {}) }} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "accounts" && <AccountsSettings ctx={ctx} />}
      {tab === "categories" && <CategoriesSettings ctx={ctx} />}
      {tab === "currency" && <CurrencySettings ctx={ctx} />}
      {tab === "ai" && <AISettings ctx={ctx} />}
      {tab === "data" && <DataSettings ctx={ctx} />}
      {tab === "activity" && <ActivitySettings ctx={ctx} />}
      {tab === "demo" && <DemoSettings ctx={ctx} />}
    </div>
  );
}

function AccountsSettings({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const [name, setName] = useState("");
  const [type, setType] = useState(ACCOUNT_TYPES[0]);
  const [start, setStart] = useState("");
  const [currency, setCurrency] = useState(userData.settings.baseCurrency);

  const addAccount = () => {
    if (!name.trim()) { addToast("error", "Give the account a name."); return; }
    updateUser((prev) => ({ ...prev, accounts: [...prev.accounts, { id: uid(), name: name.trim(), type, startingBalanceMinor: toMinor(start), currency, active: true }] }));
    setName(""); setStart("");
    addToast("success", "Account added");
  };
  const toggleActive = (id) => updateUser((prev) => ({ ...prev, accounts: prev.accounts.map((a) => a.id === id ? { ...a, active: a.active === false } : a) }));
  const removeAccount = (id) => {
    if (userData.transactions.some((t) => t.account === id || t.fromAccount === id || t.toAccount === id)) {
      addToast("error", "This account has transactions — deactivate it instead of deleting.");
      return;
    }
    updateUser((prev) => ({ ...prev, accounts: prev.accounts.filter((a) => a.id !== id) }));
  };

  return (
    <div style={styles.twoCol}>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>New account</h2>
        <div style={styles.form}>
          <input style={styles.input} placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
          <select style={styles.input} value={type} onChange={(e) => setType(e.target.value)}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <div style={styles.formRow}>
            <input style={styles.input} type="number" placeholder="Starting balance" value={start} onChange={(e) => setStart(e.target.value)} />
            <select style={styles.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>{Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <button style={styles.primaryBtn} onClick={addAccount}><Plus size={15} /> Add account</button>
        </div>
      </div>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Your accounts</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {userData.accounts.map((a) => {
            const Icon = ACCOUNT_ICONS[a.type] || Wallet;
            const bal = accountBalance(a, userData.transactions);
            return (
              <div key={a.id} style={{ ...styles.accountRow, opacity: a.active === false ? 0.45 : 1 }}>
                <Icon size={16} color="#2F6F62" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "#9A9587" }}>{a.type}</div>
                </div>
                <span style={{ fontFamily: "IBM Plex Mono", fontSize: 13 }}>{money(bal, a.currency)}</span>
                <button style={styles.miniToggleBtn} onClick={() => toggleActive(a.id)}>{a.active === false ? "Activate" : "Deactivate"}</button>
                <button style={styles.iconBtn} onClick={() => removeAccount(a.id)}><Trash2 size={13} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CategoriesSettings({ ctx }) {
  const { userData, updateUser } = ctx;
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim() || userData.settings.categories.includes(name.trim())) return;
    updateUser((prev) => ({ ...prev, settings: { ...prev.settings, categories: [...prev.settings.categories, name.trim()] } }));
    setName("");
  };
  const remove = (c) => updateUser((prev) => ({ ...prev, settings: { ...prev.settings, categories: prev.settings.categories.filter((x) => x !== c) } }));
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Manage categories</h2>
      <div style={styles.formRow}>
        <input style={styles.input} placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button style={styles.secondaryBtn} onClick={add}>Add</button>
      </div>
      <div style={{ ...styles.chipRow, marginTop: 12 }}>
        {userData.settings.categories.map((c) => (
          <span key={c} style={{ ...styles.chip, display: "flex", alignItems: "center", gap: 6 }}>
            {c} <X size={11} style={{ cursor: "pointer" }} onClick={() => remove(c)} />
          </span>
        ))}
      </div>
    </div>
  );
}

function CurrencySettings({ ctx }) {
  const { userData, updateUser } = ctx;
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Base currency</h2>
      <p style={{ fontSize: 12.5, color: "#8A8A7E", marginTop: -6 }}>
        Dashboard totals aggregate transactions in your base currency. Transactions in other currencies are tracked and shown individually, but not converted — this demo doesn't connect to a live exchange-rate feed.
      </p>
      <select style={{ ...styles.input, width: 220 }} value={userData.settings.baseCurrency} onChange={(e) => updateUser((prev) => ({ ...prev, settings: { ...prev.settings, baseCurrency: e.target.value } }))}>
        {Object.entries(CURRENCIES).map(([c, v]) => <option key={c} value={c}>{c} — {v.label}</option>)}
      </select>
    </div>
  );
}

function AISettings({ ctx }) {
  const { userData, updateUser } = ctx;
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>AI features</h2>
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={userData.settings.aiEnabled} onChange={(e) => updateUser((prev) => ({ ...prev, settings: { ...prev.settings, aiEnabled: e.target.checked } }))} />
        <span>Enable AI category suggestions</span>
      </label>
      <p style={{ fontSize: 12, color: "#8A8A7E", marginTop: 10, lineHeight: 1.5 }}>
        When enabled, only the transaction description text is sent to suggest a category, type, and tags — nothing else about your accounts or history. The request goes to <code>/api/ai-suggest</code>,
        a serverless function that holds the Anthropic API key server-side; the key never reaches the browser. If that environment variable isn't set on this deployment, suggestions will just fail
        quietly with a toast — everything else in the app keeps working.
      </p>
    </div>
  );
}

function DataSettings({ ctx }) {
  const { userData, updateUser, addToast } = ctx;
  const fileRef = useRef(null);
  const accountsById = useMemo(() => Object.fromEntries(userData.accounts.map((a) => [a.id, a])), [userData.accounts]);
  const accountsByName = useMemo(() => Object.fromEntries(userData.accounts.map((a) => [a.name.toLowerCase(), a])), [userData.accounts]);

  const [parsed, setParsed] = useState(null); // {headers, records}
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null); // {valid, invalid, duplicate}

  const exportTxns = () => downloadText(`moneyflow-transactions-${todayISO()}.csv`, transactionsToCSV(userData.transactions, accountsById));

  const onFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, records } = parseCSV(String(reader.result));
      setParsed({ headers, records });
      setMapping(guessMapping(headers));
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const runValidation = () => {
    if (!parsed || !mapping) return;
    const seen = new Set(userData.transactions.map((t) => `${t.date}|${t.description.toLowerCase()}|${t.amountMinor}`));
    const valid = [], invalid = [], duplicate = [];
    parsed.records.forEach((r, i) => {
      const date = r[mapping.date];
      const description = r[mapping.description];
      const amountRaw = r[mapping.amount];
      const type = (r[mapping.type] || "expense").toLowerCase();
      const errors = [];
      if (!date || isNaN(new Date(date).getTime())) errors.push("bad date");
      if (!description) errors.push("missing description");
      const amt = parseFloat(amountRaw);
      if (isNaN(amt) || amt <= 0) errors.push("bad amount");
      if (!TXN_TYPES.some((t) => t.key === type)) errors.push("unknown type");
      if (errors.length) { invalid.push({ row: i + 2, errors, raw: r }); return; }
      const key = `${date}|${description.toLowerCase()}|${toMinor(amt)}`;
      const record = {
        id: uid(), date, description, amountMinor: toMinor(amt), type,
        category: mapping.category ? r[mapping.category] || "Other" : "Other",
        account: mapping.account && accountsByName[(r[mapping.account] || "").toLowerCase()] ? accountsByName[(r[mapping.account] || "").toLowerCase()].id : userData.accounts[0]?.id,
        currency: userData.settings.baseCurrency,
        tags: mapping.tags ? (r[mapping.tags] || "").split("|").map((s) => s.trim()).filter(Boolean) : [],
        notes: mapping.notes ? r[mapping.notes] || "" : "",
        createdAt: nowISO(),
      };
      if (seen.has(key)) duplicate.push(record); else valid.push(record);
    });
    setPreview({ valid, invalid, duplicate });
  };

  const confirmImport = () => {
    if (!preview) return;
    updateUser((prev) => {
      let next = { ...prev, transactions: [...preview.valid, ...prev.transactions] };
      next = audit(next, "csv_import", `${preview.valid.length} transaction(s) imported`);
      return next;
    });
    addToast("success", `Imported ${preview.valid.length} transactions`);
    setParsed(null); setMapping(null); setPreview(null);
  };

  return (
    <div>
      <div style={styles.card}>
        <h2 style={styles.cardTitle}><Download size={14} style={{ verticalAlign: -2 }} /> Export</h2>
        <p style={{ fontSize: 12.5, color: "#8A8A7E", marginTop: -6 }}>Download every transaction as CSV.</p>
        <button style={styles.secondaryBtn} onClick={exportTxns}>Export transactions.csv</button>
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}><Upload size={14} style={{ verticalAlign: -2 }} /> Import</h2>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
        <button style={styles.secondaryBtn} onClick={() => fileRef.current.click()}>Choose CSV file</button>

        {parsed && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, color: "#6B695E", marginBottom: 8 }}>Map your columns to MoneyFlow fields:</div>
            <div style={styles.mapGrid}>
              {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, width: 90, textTransform: "capitalize" }}>{f}{REQUIRED_FIELDS.includes(f) ? " *" : ""}</span>
                  <select style={styles.input} value={mapping[f] || ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                    <option value="">— none —</option>
                    {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button style={{ ...styles.primaryBtn, marginTop: 10 }} onClick={runValidation}>Preview import</button>
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div style={styles.previewStats}>
              <span style={{ color: "#4FB88F" }}>{preview.valid.length} valid</span>
              <span style={{ color: "#D9A441" }}>{preview.duplicate.length} duplicate (skipped)</span>
              <span style={{ color: "#C4436B" }}>{preview.invalid.length} invalid</span>
            </div>
            {preview.invalid.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#B5533C", marginTop: 6 }}>
                {preview.invalid.slice(0, 5).map((r, i) => <div key={i}>Row {r.row}: {r.errors.join(", ")}</div>)}
                {preview.invalid.length > 5 && <div>…and {preview.invalid.length - 5} more</div>}
              </div>
            )}
            <button style={{ ...styles.primaryBtn, marginTop: 10 }} onClick={confirmImport} disabled={preview.valid.length === 0}>
              <Check size={14} /> Import {preview.valid.length} transaction{preview.valid.length === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivitySettings({ ctx }) {
  const { userData } = ctx;
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}><History size={14} style={{ verticalAlign: -2 }} /> Activity log</h2>
      {userData.auditLog.length === 0 ? <EmptyState text="No activity recorded yet." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 420, overflowY: "auto" }}>
          {userData.auditLog.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, fontSize: 12, padding: "7px 0", borderBottom: "1px solid #EDEBDF" }}>
              <span style={{ color: "#9A9587", fontFamily: "IBM Plex Mono", fontSize: 10.5, width: 130, flexShrink: 0 }}>{new Date(e.at).toLocaleString()}</span>
              <span style={{ color: "#6B695E" }}><b style={{ color: "#2A2A24" }}>{e.action.replace(/_/g, " ")}</b> — {e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoSettings({ ctx }) {
  const { accountId, userData, updateUser, addToast } = ctx;
  const resetDemo = () => {
    updateUser(emptyUserData(accountId, userData.name));
    addToast("info", "Data reset");
  };
  const exportEverything = () => downloadText(`moneyflow-full-export-${todayISO()}.json`, JSON.stringify(userData, null, 2), "application/json");
  const deleteEverything = () => {
    if (!window.confirm("This clears all your MoneyFlow data. Continue?")) return;
    resetDemo();
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Demo Mode &amp; privacy</h2>
      <p style={{ fontSize: 12.5, color: "#8A8A7E", lineHeight: 1.6 }}>
        Your account is protected by a password now, and your personal data (accounts, transactions, budgets, goals) is locked to your login —
        no one else can read or edit it. One thing still worth knowing: group data is shared with anyone who has the group, and any signed-in
        person can currently open any group by its id, since the app doesn't yet track per-group membership at the account level. Fine for
        groups of people who already trust each other; see the README if you want to tighten that further.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button style={styles.secondaryBtn} onClick={exportEverything}>Export all my data (JSON)</button>
        <button style={styles.dangerBtn} onClick={deleteEverything}>Reset my data</button>
      </div>
    </div>
  );
}

const styles = {
  app: { minHeight: "100%", background: "#EDEFE9", fontFamily: "Inter, sans-serif", color: "#2A2A24" },
  topbar: { display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: "#1C2B33", position: "sticky", top: 0, zIndex: 30 },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, color: "#F2F1EC" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, background: "#2F6F62", color: "#fff", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  topRight: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 },
  iconTopBtn: { position: "relative", background: "transparent", border: "1px solid #3A4B54", color: "#F2F1EC", borderRadius: 7, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  badge: { position: "absolute", top: -5, right: -5, background: "#B5533C", color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 8, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" },
  logoutBtn: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #3A4B54", color: "#F2F1EC", padding: "7px 10px", borderRadius: 7, fontSize: 12, cursor: "pointer" },
  body: { display: "flex", maxWidth: 1280, margin: "0 auto" },
  sideNav: { width: 190, flexShrink: 0, padding: "18px 12px", display: "flex", flexDirection: "column", gap: 2 },
  navBtn: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 7, border: "none", background: "transparent", color: "#5C5C50", fontSize: 13, cursor: "pointer", textAlign: "left" },
  navBtnActive: { background: "#FBFAF6", color: "#1C2B33", fontWeight: 700, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
  main: { flex: 1, padding: "18px 20px 90px", minWidth: 0 },
  demoBanner: { display: "flex", alignItems: "center", gap: 8, background: "#FBEFD9", border: "1px solid #EDD9A8", color: "#7A5E22", padding: "8px 12px", borderRadius: 8, fontSize: 11.5, marginBottom: 16 },
  mobileNav: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#1C2B33", padding: "8px 6px", alignItems: "center", justifyContent: "space-around", zIndex: 30 },
  mobileNavBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", color: "#8FA89C", cursor: "pointer", padding: "4px 6px" },
  mobileNavBtnActive: { color: "#F2F1EC" },
  mobileFab: { width: 42, height: 42, borderRadius: "50%", background: "#2F6F62", border: "3px solid #1C2B33", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginTop: -20 },
  loginWrap: { minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#EDEFE9", fontFamily: "Inter, sans-serif" },
  loginCard: { background: "#FBFAF6", border: "1px solid #DCE0D3", borderRadius: 12, padding: "36px 32px", width: 340, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" },
  loginTitle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 26, margin: "6px 0 0" },
  loginSub: { fontSize: 13, color: "#6B695E", margin: "0 0 10px" },
  loginNote: { fontSize: 10.5, color: "#9A9587", marginTop: 10, lineHeight: 1.4 },
  authError: { background: "#FBEAE5", color: "#B5533C", border: "1px solid #EFC9BB", borderRadius: 7, padding: "8px 10px", fontSize: 12, textAlign: "left" },
  loaderWrap: { minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#EDEFE9" },
  input: { width: "100%", padding: "10px 12px", borderRadius: 7, border: "1px solid #DCE0D3", fontSize: 14, boxSizing: "border-box", fontFamily: "Inter" },
  primaryBtn: { display: "flex", alignItems: "center", gap: 6, background: "#2F6F62", color: "#fff", border: "none", borderRadius: 7, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  card: { background: "#FBFAF6", border: "1px solid #DCE0D3", borderRadius: 10, padding: 18, marginBottom: 16 },
  cardTitle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 },
  iconBtn: { background: "transparent", border: "none", color: "#8A8A7E", cursor: "pointer", padding: 4, display: "flex" },
  toastStack: { position: "fixed", bottom: 70, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 60, maxWidth: 280 },
  toast: { background: "#1C2B33", color: "#F2F1EC", padding: "10px 14px", borderRadius: 7, fontSize: 12.5, borderLeft: "4px solid #5B7C99", boxShadow: "0 4px 14px rgba(0,0,0,0.2)" },
  notifPanel: { position: "absolute", top: 40, right: 0, width: 290, background: "#fff", border: "1px solid #DCE0D3", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 40, color: "#2A2A24" },
  notifHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #EDEBDF" },
  notifRow: { display: "flex", gap: 8, padding: "10px 12px", borderBottom: "1px solid #F4F2E9" },
  notifDot: { width: 7, height: 7, borderRadius: "50%", marginTop: 5, flexShrink: 0 },

  /* -- layout/page -- */
  rowHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  pageTitle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 24, margin: "2px 0 14px" },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#9A9587", fontSize: 13, padding: "34px 10px", textAlign: "center" },
  healthLine: { display: "flex", alignItems: "center", gap: 7, background: "#E7EFE6", color: "#2F6F62", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 16, fontWeight: 600 },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 },
  statCard: { background: "#FBFAF6", border: "1px solid #DCE0D3", borderRadius: 10, padding: "14px 16px" },
  quickActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  quickActionBtn: { display: "flex", alignItems: "center", gap: 6, background: "#FBFAF6", border: "1px solid #DCE0D3", borderRadius: 7, padding: "8px 12px", fontSize: 12, cursor: "pointer", color: "#2A2A24" },

  /* -- forms / inputs shared -- */
  form: { display: "flex", flexDirection: "column", gap: 9 },
  formRow: { display: "flex", gap: 9 },
  label: { fontSize: 11.5, color: "#8A8A7E", marginTop: 2 },
  secondaryBtn: { background: "#E7E4D8", color: "#2A2A24", border: "none", borderRadius: 7, padding: "0 16px", fontWeight: 600, fontSize: 13, cursor: "pointer", minHeight: 38 },
  dangerBtn: { background: "#B5533C", color: "#fff", border: "none", borderRadius: 7, padding: "9px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" },
  secondarySubmitBtn: { background: "#2F6F62", color: "#fff", border: "none", borderRadius: 6, padding: "0 14px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" },
  secondarySubmitBtnAlt: { background: "#8C6E4C", color: "#fff", border: "none", borderRadius: 6, padding: "0 14px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },

  /* -- filters / search -- */
  filterBar: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  searchBox: { display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #DCE0D3", borderRadius: 7, padding: "0 10px", flex: 1, minWidth: 200 },
  searchInput: { border: "none", outline: "none", padding: "9px 0", fontSize: 13, flex: 1, background: "transparent", fontFamily: "Inter" },
  filterSelect: { border: "1px solid #DCE0D3", borderRadius: 7, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "Inter" },

  /* -- transactions table -- */
  txnHeadRow: { display: "grid", gridTemplateColumns: "82px 1fr 100px 110px 90px 26px", gap: 8, fontFamily: "IBM Plex Mono", fontSize: 10.5, color: "#9A9587", textTransform: "uppercase", padding: "6px 4px", borderBottom: "1px solid #DCE0D3" },
  txnRow: { display: "grid", gridTemplateColumns: "82px 1fr 100px 110px 90px 26px", gap: 8, alignItems: "center", padding: "9px 4px", borderBottom: "1px solid #EDEBDF", fontSize: 12.5 },
  mono11: { fontFamily: "IBM Plex Mono", fontSize: 11, color: "#6B695E" },
  catTag: { fontSize: 10.5, padding: "2px 8px", borderRadius: 10, fontWeight: 600 },
  tagRow: { display: "inline-flex", gap: 4, marginLeft: 6 },
  tagChip: { fontSize: 9.5, background: "#EDEFE9", color: "#6B695E", padding: "1px 6px", borderRadius: 8 },

  /* -- type/scope chips -- */
  typeToggle: { display: "flex", gap: 8 },
  typeBtn: { flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid #DCE0D3", background: "#fff", cursor: "pointer", fontFamily: "Inter", fontSize: 13, color: "#6B695E" },
  typeRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  typeChip: { padding: "6px 12px", borderRadius: 14, border: "1px solid #DCE0D3", background: "#fff", fontSize: 12, cursor: "pointer", color: "#6B695E" },
  scopeToggle: { display: "flex", gap: 6, marginBottom: 12 },
  scopeBtn: { flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid #DCE0D3", background: "#fff", cursor: "pointer", fontSize: 13, color: "#6B695E" },
  scopeBtnActive: { background: "#1C2B33", color: "#fff", borderColor: "#1C2B33" },

  /* -- budgets -- */
  budgetGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 },
  budgetRow: { display: "flex", flexDirection: "column", gap: 6 },
  budgetTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  budgetInput: { width: 70, padding: "3px 6px", borderRadius: 5, border: "1px solid #DCE0D3", fontSize: 12, fontFamily: "IBM Plex Mono" },
  budgetBarTrack: { height: 6, borderRadius: 3, background: "#E3E0D5", overflow: "hidden" },
  budgetBarFill: { height: "100%", borderRadius: 3, transition: "width 0.3s" },
  budgetFoot: { display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "IBM Plex Mono" },
  forecastWarn: { display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#B5533C", marginTop: 2 },
  thresholdInput: { width: 46, padding: "4px 6px", borderRadius: 5, border: "1px solid #DCE0D3", fontSize: 12, fontFamily: "IBM Plex Mono" },

  /* -- goals -- */
  goalGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 },
  goalCard: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid #DCE0D3", borderRadius: 8, padding: 14, background: "#fff" },
  goalTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  goalName: { fontWeight: 700, fontSize: 14, fontFamily: "Space Grotesk, sans-serif" },
  goalDeadline: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9A9587" },

  /* -- groups -- */
  groupGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 },
  groupCard: { display: "flex", alignItems: "center", gap: 10, background: "#FBFAF6", border: "1px solid #DCE0D3", borderRadius: 10, padding: "14px 16px", cursor: "pointer" },
  groupCardName: { fontWeight: 700, fontSize: 14 },
  backBtn: { background: "none", border: "none", color: "#8A8A7E", fontSize: 12.5, cursor: "pointer", padding: 0, marginBottom: 6 },
  avatarRow: { display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  avatarWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  avatar: { width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12 },
  avatarName: { fontSize: 11, color: "#6B695E" },
  tabs: { display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #DCE0D3", flexWrap: "wrap" },
  tab: { padding: "8px 12px", background: "none", border: "none", borderBottom: "2px solid transparent", fontSize: 12.5, fontWeight: 600, color: "#9A9587", cursor: "pointer" },
  tabActive: { color: "#2F6F62", borderBottomColor: "#2F6F62" },
  memberRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #EDEBDF" },
  expenseList: { display: "flex", flexDirection: "column", gap: 4 },
  expenseRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EDEBDF" },
  expenseTitle: { fontSize: 13, fontWeight: 600 },
  expenseSub: { fontSize: 11, color: "#9A9587" },
  expenseAmount: { fontWeight: 700, fontSize: 13, fontFamily: "monospace" },
  netGrid: { display: "flex", flexDirection: "column", gap: 10 },
  netRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 },
  settleList: { display: "flex", flexDirection: "column", gap: 8 },
  settleRow: { display: "flex", alignItems: "center", gap: 8, background: "#F7F5EC", border: "1px solid #E3E0D5", borderRadius: 8, padding: "10px 12px", fontSize: 13, flexWrap: "wrap" },
  settleName: { fontWeight: 600 },
  settleAmt: { marginLeft: "auto", fontFamily: "monospace", fontWeight: 700, color: "#B5533C" },
  settleBtn: { display: "flex", alignItems: "center", gap: 4, background: "#4FB88F", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" },
  subRow: { display: "flex", alignItems: "center", gap: 10, background: "#F7F5EC", border: "1px solid #E3E0D5", borderRadius: 8, padding: "10px 12px" },

  /* -- split editor -- */
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 },
  chip: { background: "#EDEFE9", color: "#2A2A24", padding: "5px 11px", borderRadius: 14, fontSize: 12 },
  chipActive: { background: "#2F6F62", color: "#fff" },
  splitTypeRow: { display: "flex", gap: 6, marginTop: 2 },
  splitTypeBtn: { flex: 1, padding: "7px 0", borderRadius: 6, border: "1px solid #DCE0D3", background: "#fff", cursor: "pointer", fontSize: 12, color: "#6B695E" },
  splitTypeBtnActive: { background: "#1C2B33", color: "#fff", borderColor: "#1C2B33" },
  splitDetailList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 8, background: "#F7F5EC", border: "1px solid #E3E0D5", borderRadius: 8, padding: 10 },
  splitDetailRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 },
  splitDetailInput: { width: 74, padding: "5px 8px", borderRadius: 6, border: "1px solid #DCE0D3", fontSize: 12, marginLeft: "auto" },

  /* -- AI suggest -- */
  suggestBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 38, border: "1px solid #DCE0D3", borderRadius: 6, background: "#F2F1EC", color: "#2F6F62", cursor: "pointer" },
  aiSuggestBox: { background: "#EEF3EA", border: "1px solid #D3E0CB", borderRadius: 8, padding: 10 },
  miniAcceptBtn: { display: "flex", alignItems: "center", gap: 4, background: "#2F6F62", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" },
  miniRejectBtn: { background: "transparent", border: "1px solid #DCE0D3", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", color: "#6B695E" },
  miniToggleBtn: { background: "transparent", border: "1px solid #DCE0D3", borderRadius: 6, padding: "5px 9px", fontSize: 11, cursor: "pointer", color: "#6B695E" },

  /* -- modal -- */
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(28,43,51,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: 22, width: 380, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 },
  modalHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18 },

  /* -- settings: accounts / import -- */
  accountRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EDEBDF" },
  mapGrid: { display: "flex", flexDirection: "column", gap: 8 },
  previewStats: { display: "flex", gap: 14, fontSize: 12.5, fontWeight: 600 },
};
