"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { Contact, ContactTag } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { X } from "lucide-react";

const PRESET_COLORS = ["#e05555","#d97706","#16a34a","#2563eb","#7c3aed","#db2777","#0891b2","#65a30d","#ea580c","#6366f1"];

// ─── Tag Badge ──────────────────────────────────────────────────
function TagBadge({ tag }: { tag: ContactTag }) {
  return (
    <span className="inline-flex items-center rounded-full text-[10px] px-2 py-0.5 font-medium"
      style={{ backgroundColor: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44` }}>
      {tag.name}
    </span>
  );
}

// ─── Tag Manager Modal ──────────────────────────────────────────
function TagManager({ open, onClose, userId, tags, onSaved }: {
  open: boolean; onClose: () => void; userId: string; tags: ContactTag[]; onSaved: () => void;
}) {
  const [local, setLocal] = useState<ContactTag[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const { toast } = useToast();

  useEffect(() => { if (open) { setLocal(tags); setEditId(null); } }, [open, tags]);

  const addTag = async () => {
    if (!newName.trim()) return;
    const supabase = createClient();
    const { data } = await supabase.from("contact_tags").insert({
      user_id: userId, name: newName.trim(), color: newColor, sort_order: local.length,
    }).select().single();
    if (data) { setLocal(prev => [...prev, data as ContactTag]); onSaved(); }
    setNewName(""); setNewColor(PRESET_COLORS[(local.length + 1) % PRESET_COLORS.length]);
  };

  const saveEdit = async () => {
    if (!editName.trim() || !editId) return;
    const supabase = createClient();
    await supabase.from("contact_tags").update({ name: editName.trim(), color: editColor }).eq("id", editId);
    setLocal(prev => prev.map(t => t.id === editId ? { ...t, name: editName.trim(), color: editColor } : t));
    setEditId(null);
    onSaved();
  };

  const removeTag = async (id: string) => {
    const supabase = createClient();
    await supabase.from("contact_tags").delete().eq("id", id);
    setLocal(prev => prev.filter(t => t.id !== id));
    onSaved();
    toast("Tag deleted", "info");
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage Tags">
      <div className="space-y-4">
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Tag name..."
            onKeyDown={e => e.key === "Enter" && addTag()}
            className="flex-1 bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-violet" />
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
            className="w-10 h-10 rounded-lg border border-border bg-surface3 cursor-pointer" />
          <button onClick={addTag} disabled={!newName.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-40">Add</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => setNewColor(c)}
              className="w-6 h-6 rounded-full transition-all"
              style={{ backgroundColor: c, border: `2px solid ${newColor === c ? "white" : "transparent"}`, transform: newColor === c ? "scale(1.1)" : "scale(1)" }} />
          ))}
        </div>
        {local.length === 0 && <p className="text-sm text-txt3 text-center py-4">No tags yet</p>}
        <div className="space-y-2">
          {local.map(tag => (
            <div key={tag.id} className="flex items-center gap-2 bg-surface3 rounded-lg px-3 py-2">
              {editId === tag.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && saveEdit()}
                    className="flex-1 bg-surface2 border border-border rounded px-2 py-1 text-sm text-txt focus:outline-none" autoFocus />
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                    className="w-8 h-8 rounded border border-border bg-surface2 cursor-pointer" />
                  <button onClick={saveEdit} className="text-xs text-green-acc">Save</button>
                  <button onClick={() => setEditId(null)} className="text-xs text-txt3">Cancel</button>
                </>
              ) : (
                <>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="flex-1 text-sm text-txt">{tag.name}</span>
                  <button onClick={() => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color); }} className="text-xs text-txt3 hover:text-txt">Edit</button>
                  <button onClick={() => removeTag(tag.id)} className="text-xs text-danger hover:text-red-400">Delete</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Contact Form Modal ─────────────────────────────────────────
function ContactForm({ open, onClose, userId, tags, initial, onSaved }: {
  open: boolean; onClose: () => void; userId: string; tags: ContactTag[]; initial?: Contact | null; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [address, setAddress] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [altEmail, setAltEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name); setEmail(initial.email); setPhone(initial.phone);
      setSelectedTags(initial.tags?.map(t => t.id) || []);
      setAddress(initial.address); setAltPhone(initial.alt_phone);
      setAltEmail(initial.alt_email); setNotes(initial.notes); setCompanyNumber(initial.company_number);
      setShowMore(!!(initial.address || initial.alt_phone || initial.alt_email || initial.notes || initial.company_number));
    } else {
      setName(""); setEmail(""); setPhone(""); setSelectedTags([]);
      setAddress(""); setAltPhone(""); setAltEmail(""); setNotes(""); setCompanyNumber(""); setShowMore(false);
    }
  }, [open, initial]);

  const toggleTag = (id: string) => setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const supabase = createClient();
    const row = { user_id: userId, name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), alt_phone: altPhone.trim(), alt_email: altEmail.trim(), notes: notes.trim(), company_number: companyNumber.trim() };

    let contactId: string;
    if (initial) {
      await supabase.from("contacts").update(row).eq("id", initial.id);
      contactId = initial.id;
    } else {
      const { data } = await supabase.from("contacts").insert({ ...row, sort_order: 0 }).select("id").single();
      if (!data) { setSaving(false); return; }
      contactId = data.id;
    }

    // Sync tag links: delete all then re-insert
    await supabase.from("contact_tag_links").delete().eq("contact_id", contactId);
    if (selectedTags.length > 0) {
      await supabase.from("contact_tag_links").insert(selectedTags.map(tag_id => ({ contact_id: contactId, tag_id })));
    }

    setSaving(false);
    onSaved();
    onClose();
  };

  const F = ({ label, value, onChange, placeholder, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) => (
    <div>
      <label className="block text-xs text-txt3 mb-1.5">{label}{required && <span className="text-danger"> *</span>}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-violet" />
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit Contact" : "Add Contact"} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <F label="Name" value={name} onChange={setName} placeholder="John Doe" required />
          <F label="Email" value={email} onChange={setEmail} placeholder="john@example.com" type="email" />
          <F label="Phone" value={phone} onChange={setPhone} placeholder="+33 6 12 34 56 78" />
          <div>
            <label className="block text-xs text-txt3 mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5 min-h-[38px] bg-surface3 border border-border rounded-lg px-3 py-2 items-center">
              {tags.length === 0 && <span className="text-xs text-txt3">No tags — create some first</span>}
              {tags.map(tag => (
                <button key={tag.id} onClick={() => toggleTag(tag.id)}
                  className="inline-flex items-center rounded-full text-[10px] px-2 py-0.5 font-medium transition-all"
                  style={{ backgroundColor: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44`,
                    opacity: selectedTags.includes(tag.id) ? 1 : 0.35, outline: selectedTags.includes(tag.id) ? `2px solid ${tag.color}88` : "none", outlineOffset: 1 }}>
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => setShowMore(!showMore)} className="text-xs text-violet2 hover:text-violet">
          {showMore ? "▾ Hide additional details" : "▸ Show additional details"}
        </button>
        {showMore && (
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border/50">
            <F label="Address" value={address} onChange={setAddress} placeholder="123 Main St" />
            <F label="Company number" value={companyNumber} onChange={setCompanyNumber} placeholder="IČO / VAT" />
            <F label="Other phone" value={altPhone} onChange={setAltPhone} />
            <F label="Other email" value={altEmail} onChange={setAltEmail} type="email" />
            <div className="col-span-2">
              <label className="block text-xs text-txt3 mb-1.5">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Any notes..."
                className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-sm text-txt focus:outline-none focus:border-violet resize-none" />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-txt3 hover:bg-surface3">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white disabled:opacity-40">
            {saving ? "Saving..." : initial ? "Save" : "Add Contact"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Details Modal ──────────────────────────────────────────────
function DetailsModal({ open, onClose, contact, onCopy }: { open: boolean; onClose: () => void; contact: Contact | null; onCopy: (t: string) => void }) {
  if (!open || !contact) return null;
  const tags = contact.tags || [];

  const Row = ({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) => {
    if (!value) return null;
    return (
      <div className="mb-3">
        <span className="text-[10px] text-txt3 uppercase tracking-wider">{label}</span>
        <p className="text-sm text-txt mt-0.5 flex items-center gap-2 whitespace-pre-wrap">
          {value}
          {copyable && <button onClick={() => { navigator.clipboard.writeText(value); onCopy(`Copied ${label.toLowerCase()}`); }} className="text-[11px] text-txt3 hover:text-txt" title="Copy">📋</button>}
        </p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.25)" }} />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border"
        style={{
          background: "rgba(30,24,52,0.5)",
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          borderColor: "rgba(140,120,220,0.25)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(140,120,220,0.15), inset 0 0 40px rgba(100,80,180,0.06)",
        }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(124,110,196,0.15)" }}>
          <h2 className="text-lg font-semibold text-bright">{contact.name}</h2>
          <button onClick={onClose} className="text-txt3 hover:text-txt text-xl leading-none">×</button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-1">
            <Row label="Email" value={contact.email} copyable />
            <Row label="Phone" value={contact.phone} copyable />
          </div>
          {tags.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{tags.map(t => <TagBadge key={t.id} tag={t} />)}</div>}
          <div className="border-t border-border/30 pt-4">
            <Row label="Address" value={contact.address} copyable />
            <Row label="Company number" value={contact.company_number} copyable />
            <Row label="Other phone" value={contact.alt_phone} copyable />
            <Row label="Other email" value={contact.alt_email} copyable />
            <Row label="Notes" value={contact.notes} />
          </div>
          <div className="border-t border-border/30 pt-3 mt-2">
            <span className="text-[10px] text-txt3">Added {new Date(contact.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────
export function ContactsPanel({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "newest">("name");
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<string | null>(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const [{ data: c }, { data: t }, { data: links }] = await Promise.all([
      supabase.from("contacts").select("*").eq("user_id", userId).order("sort_order"),
      supabase.from("contact_tags").select("*").eq("user_id", userId).order("sort_order"),
      supabase.from("contact_tag_links").select("contact_id, tag_id"),
    ]);

    const tagMap: Record<string, ContactTag> = {};
    for (const tag of (t || []) as ContactTag[]) tagMap[tag.id] = tag;

    const contactTags: Record<string, ContactTag[]> = {};
    for (const link of (links || []) as { contact_id: string; tag_id: string }[]) {
      if (tagMap[link.tag_id]) {
        (contactTags[link.contact_id] ||= []).push(tagMap[link.tag_id]);
      }
    }

    setContacts((c || []).map((contact: Contact) => ({ ...contact, tags: contactTags[contact.id] || [] })));
    setTags((t || []) as ContactTag[]);
  }, [userId]);

  useEffect(() => { if (open) loadData(); }, [open, loadData]);

  // Close menu on outside click
  useEffect(() => { menuRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-cmenu]")) return;
      setMenuOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Escape closes panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !formOpen && !tagModalOpen && !detailContact) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, formOpen, tagModalOpen, detailContact, onClose]);

  const deleteContact = async (id: string) => {
    if (!confirm("Delete this contact?")) return;
    const supabase = createClient();
    await supabase.from("contacts").delete().eq("id", id);
    setContacts(prev => prev.filter(c => c.id !== id));
    setMenuOpen(null);
    toast("Contact deleted", "info");
  };

  const filtered = contacts
    .filter(c => {
      const q = search.toLowerCase();
      const matchSearch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q);
      return matchSearch && (!filterTag || (c.tags || []).some(t => t.id === filterTag));
    })
    .sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const tagCounts: Record<string, number> = {};
  contacts.forEach(c => (c.tags || []).forEach(t => { tagCounts[t.id] = (tagCounts[t.id] || 0) + 1; }));

  return (
    <>
      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.3)" }} onClick={onClose} />}

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col border-l transition-transform duration-300 ease-in-out"
        style={{
          width: 440,
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "#16152a",
          borderColor: "#2e2d3d",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span className="text-lg">📇</span>
          <h2 className="font-title text-lg text-bright flex-1">Contacts</h2>
          <span className="text-xs text-txt3 font-mono">{contacts.length}</span>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-txt3 hover:text-txt transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 space-y-3 border-b border-border shrink-0">
          <div className="flex gap-2">
            <button onClick={() => { setEditContact(null); setFormOpen(true); }}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-acc hover:bg-red-dark text-white">＋ Add Contact</button>
            <button onClick={() => setTagModalOpen(true)}
              className="px-3 py-2 rounded-lg text-xs bg-surface2 border border-border text-txt3 hover:text-txt">🏷 Tags</button>
            <div className="flex-1" />
            <button onClick={() => setSortBy(s => s === "name" ? "newest" : "name")}
              className="px-2 py-2 rounded-lg text-[10px] text-txt3 hover:text-txt bg-surface2 border border-border">
              {sortBy === "name" ? "A→Z" : "🕐"} ↕
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts..."
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3 focus:outline-none focus:border-violet" />
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setFilterTag(null)}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                style={{ border: `1px solid ${!filterTag ? "#7c6ec4" : "#2e2d3d"}`, background: !filterTag ? "rgba(124,110,196,0.13)" : "transparent", color: !filterTag ? "#7c6ec4" : "#5c5a7a" }}>
                All ({contacts.length})
              </button>
              {tags.map(tag => (
                <button key={tag.id} onClick={() => setFilterTag(f => f === tag.id ? null : tag.id)}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                  style={{ border: `1px solid ${filterTag === tag.id ? tag.color : tag.color + "44"}`, background: filterTag === tag.id ? tag.color + "22" : "transparent", color: filterTag === tag.id ? tag.color : tag.color + "88" }}>
                  {tag.name} ({tagCounts[tag.id] || 0})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-txt3">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm">{search || filterTag ? "No contacts match" : "No contacts yet"}</p>
            </div>
          )}

          {filtered.map(contact => {
            const cTags = contact.tags || [];
            const hasDetails = !!(contact.address || contact.alt_phone || contact.alt_email || contact.notes || contact.company_number);

            return (
              <div key={contact.id} className="px-4 py-3 border-b border-border/30 hover:bg-surface2/50 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-bright flex-1 truncate">{contact.name}</span>
                  <button onClick={() => setDetailContact(contact)} title="Details"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0 transition-colors"
                    style={{ background: hasDetails ? "rgba(124,110,196,0.13)" : "transparent", color: hasDetails ? "#7c6ec4" : "#3e3d5a" }}>
                    ⓘ
                  </button>
                  <div className="relative">
                    <button data-cmenu="true" onClick={() => setMenuOpen(m => m === contact.id ? null : contact.id)}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-sm text-txt3 hover:bg-surface3 transition-colors">⋯</button>
                    {menuOpen === contact.id && (
                      <div data-cmenu="true" className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-28 z-20">
                        <button onClick={() => { setEditContact(contact); setFormOpen(true); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3">Edit</button>
                        <button onClick={() => deleteContact(contact.id)}
                          className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface3">Delete</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-txt3">
                  {contact.email && (
                    <span className="truncate cursor-pointer hover:text-txt transition-colors" title="Click to copy"
                      onClick={() => { navigator.clipboard.writeText(contact.email); toast("Email copied", "success"); }}>
                      {contact.email}
                    </span>
                  )}
                  {contact.phone && (
                    <span className="font-mono text-[11px] cursor-pointer hover:text-txt transition-colors shrink-0" title="Click to copy"
                      onClick={() => { navigator.clipboard.writeText(contact.phone); toast("Phone copied", "success"); }}>
                      {contact.phone}
                    </span>
                  )}
                </div>
                {cTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {cTags.map(t => <TagBadge key={t.id} tag={t} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      <TagManager open={tagModalOpen} onClose={() => setTagModalOpen(false)} userId={userId} tags={tags} onSaved={loadData} />
      <ContactForm open={formOpen} onClose={() => { setFormOpen(false); setEditContact(null); }} userId={userId} tags={tags} initial={editContact} onSaved={loadData} />
      <DetailsModal open={!!detailContact} onClose={() => setDetailContact(null)} contact={detailContact} onCopy={(msg) => toast(msg, "success")} />
    </>
  );
}
