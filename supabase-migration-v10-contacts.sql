-- ============================================================
-- Migration v10: Contacts & Contact Tags
-- ============================================================

-- Contact tags (lawyer, developer, client, etc.)
CREATE TABLE IF NOT EXISTS contact_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 100),
  color TEXT NOT NULL DEFAULT '#7c3aed' CHECK (char_length(color) <= 20),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_user ON contact_tags(user_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own contact_tags" ON contact_tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 200),
  email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 200),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 50),
  address TEXT NOT NULL DEFAULT '' CHECK (char_length(address) <= 500),
  alt_phone TEXT NOT NULL DEFAULT '' CHECK (char_length(alt_phone) <= 50),
  alt_email TEXT NOT NULL DEFAULT '' CHECK (char_length(alt_email) <= 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  company_number TEXT NOT NULL DEFAULT '' CHECK (char_length(company_number) <= 100),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(user_id, name);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own contacts" ON contacts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Many-to-many link between contacts and tags
CREATE TABLE IF NOT EXISTS contact_tag_links (
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

ALTER TABLE contact_tag_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own contact_tag_links" ON contact_tag_links
  FOR ALL USING (
    EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM contacts WHERE id = contact_id AND user_id = auth.uid())
  );
