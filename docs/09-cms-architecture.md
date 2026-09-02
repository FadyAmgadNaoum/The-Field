# CMS Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Philosophy

The CMS for The Field is intentionally lightweight. It is not a headless CMS platform (no Contentful, Sanity, or Strapi). It is a purpose-built content management layer that:

1. Stores all business-critical text, images, and configuration in the PostgreSQL database.
2. Exposes an admin UI for editing content without developer involvement.
3. Keeps content strongly typed and validated.
4. Serves content to the public website via server-side rendered Next.js pages.

**Why not a headless CMS?** The Field's content needs are simple and stable. An external CMS adds cost, a third-party dependency, an API integration surface, and complexity. The in-database CMS approach keeps everything in one system, eliminates external dependencies, and means the admin dashboard already has access to all content alongside booking data. For the future multi-venue platform, a proper headless CMS or a more sophisticated CMS module can be introduced.

---

## 2. Content Architecture

The CMS manages two categories of content:

### Category A: Structured Configuration (Key-Value)

Simple name-value pairs that drive the site's behavior and branding. Stored in `cms_site_settings`.

### Category B: Structured Content Collections

Repeating structured items (FAQs, gallery items, events, announcements, social links). Stored in their own tables.

---

## 3. Content Inventory

### 3.1 Site Settings (Key-Value)

| Group | Key | Type | Description | Example |
|-------|-----|------|-------------|---------|
| `general` | `venue.name` | text | Venue display name | "The Field" |
| `general` | `venue.tagline` | text | Short tagline | "Cairo's Premier Padel Experience" |
| `contact` | `venue.phone` | text | Public phone | "+20 1X XXXX XXXX" |
| `contact` | `venue.whatsapp` | text | WhatsApp number (intl format) | "+201XXXXXXXXX" |
| `contact` | `venue.email` | text | Contact email | "info@thefield.eg" |
| `contact` | `venue.address` | text | Full address | "5 Street Name, New Cairo" |
| `contact` | `venue.map_embed_url` | text | Google Maps embed src | "https://maps.google.com/..." |
| `payment` | `venue.instapay_number` | text | InstaPay receiving number | "01XXXXXXXXX" |
| `payment` | `venue.instapay_account_name` | text | Name shown on transfer | "The Field" |
| `payment` | `venue.instapay_instructions` | text | Payment instruction text | "Transfer exactly…" |
| `homepage` | `homepage.hero_headline` | text | Hero H1 | "Book Your Court at The Field" |
| `homepage` | `homepage.hero_subtitle` | text | Hero paragraph | "Cairo's best Padel courts…" |
| `homepage` | `homepage.hero_cta_label` | text | CTA button text | "Book Now" |
| `homepage` | `homepage.hero_image_key` | text | Storage key for hero BG | "cms/hero-bg.jpg" |
| `about` | `about.headline` | text | About section H2 | "About The Field" |
| `about` | `about.body` | text | Rich text / markdown | "Welcome to The Field…" |
| `about` | `about.facilities` | json | Array of facility items | `[{"icon":"...","label":"..."}]` |
| `seo` | `seo.default_title` | text | Default `<title>` | "The Field — Padel Courts Cairo" |
| `seo` | `seo.default_description` | text | Default meta description | — |
| `seo` | `seo.og_image_key` | text | OG image storage key | — |

### 3.2 Collections

| Collection | Table | Admin Route |
|-----------|-------|-------------|
| FAQs | `cms_faqs` | `/admin/cms/faqs` |
| Gallery | `cms_gallery_items` | `/admin/cms/gallery` |
| Events | `cms_events` | `/admin/cms/events` |
| Announcements | `cms_announcements` | `/admin/cms/announcements` |
| Social Links | `cms_social_links` | `/admin/cms/social` |

---

## 4. CMS Service Architecture

```
src/modules/cms/
├── cms.service.ts          # All CMS read/write operations
├── cms.repository.ts       # Database queries
├── cms.types.ts            # TypeScript types for all content
├── cms.validators.ts       # Zod schemas for each content type
└── cms.defaults.ts         # Default values for seeding
```

### 4.1 Key CMS Service Functions

```typescript
// Site settings
getSetting(venueId: string, key: string): Promise<string | null>
getSettingGroup(venueId: string, group: string): Promise<Record<string, string>>
updateSetting(venueId: string, key: string, value: string, adminId: string): Promise<void>
updateSettingGroup(venueId: string, settings: Record<string, string>, adminId: string): Promise<void>

// FAQs
getFaqs(venueId: string, publishedOnly: boolean): Promise<Faq[]>
createFaq(venueId: string, data: CreateFaqInput, adminId: string): Promise<Faq>
updateFaq(id: string, data: UpdateFaqInput, adminId: string): Promise<Faq>
deleteFaq(id: string, adminId: string): Promise<void>
reorderFaqs(venueId: string, orderedIds: string[], adminId: string): Promise<void>

// Gallery
getGalleryItems(venueId: string, publishedOnly: boolean): Promise<GalleryItem[]>
createGalleryItem(venueId: string, data: CreateGalleryInput, adminId: string): Promise<GalleryItem>
deleteGalleryItem(id: string, adminId: string): Promise<void>

// Events
getEvents(venueId: string, publishedOnly: boolean): Promise<Event[]>
createEvent(venueId: string, data: CreateEventInput, adminId: string): Promise<Event>
updateEvent(id: string, data: UpdateEventInput, adminId: string): Promise<Event>
deleteEvent(id: string, adminId: string): Promise<void>

// Announcements
getActiveAnnouncements(venueId: string): Promise<Announcement[]>  // filters by is_published + not expired
createAnnouncement(venueId: string, data: CreateAnnouncementInput, adminId: string): Promise<Announcement>

// Social Links
getSocialLinks(venueId: string): Promise<SocialLink[]>
upsertSocialLink(venueId: string, platform: string, url: string, adminId: string): Promise<void>
```

---

## 5. How Content Is Served to the Public Website

All public pages that display CMS content are **React Server Components** (RSC). They fetch content directly from the database (via the CMS service) at render time. There is no client-side fetch for CMS content.

```typescript
// app/(public)/page.tsx — Home page (Server Component)
import { cms } from '@/modules/cms/cms.service'
import { venue } from '@/lib/config'  // VENUE_ID from env var

export default async function HomePage() {
  const [hero, about, announcements, courts] = await Promise.all([
    cms.getSettingGroup(venue.id, 'homepage'),
    cms.getSettingGroup(venue.id, 'about'),
    cms.getActiveAnnouncements(venue.id),
    courts.getActiveCourts(venue.id),
  ])

  return (
    <main>
      <HeroSection headline={hero['homepage.hero_headline']} ... />
      <AboutSection body={about['about.body']} ... />
      <AnnouncementsBanner items={announcements} />
      <CourtsPreview courts={courts} />
    </main>
  )
}
```

**Caching strategy:**
- Next.js RSC caching (`fetch` cache / `unstable_cache`) is used for CMS content that changes infrequently (e.g., site settings, FAQs).
- The cache tag `cms-{venueId}` is invalidated when any CMS setting is updated via the admin dashboard.
- Booking availability is never cached — it is always fresh.

---

## 6. Admin CMS Editing Interface

### 6.1 Site Settings Editor

**Route:** `/admin/cms/settings`

The settings editor is organized into tabs matching `group_name`:

```
[General] [Contact] [Payment] [Homepage] [About] [SEO]
```

Each tab shows a form with labeled fields. Field types map to UI components:

| `value_type` | UI Component |
|-------------|-------------|
| `text` | `<input type="text">` |
| `textarea` | `<textarea>` |
| `markdown` | Markdown editor (simple: bold, italic, lists, links) |
| `image` | File upload + current image preview |
| `json` | Structured editor (specific to the key) |
| `boolean` | Toggle switch |
| `number` | `<input type="number">` |

On save, all settings in the tab group are saved in a single request. Each update is recorded in the audit log as `cms_updated` with `old_value` / `new_value`.

### 6.2 FAQs Editor

**Route:** `/admin/cms/faqs`

- Table view with drag-to-reorder (display_order updated via `reorderFaqs`).
- Add/Edit via an inline slide-over panel or modal.
- Publish/unpublish toggle per FAQ.
- Soft delete (moves to "Archived" tab).

### 6.3 Gallery Editor

**Route:** `/admin/cms/gallery`

- Grid view of uploaded images.
- Upload new images (drag-and-drop or file picker).
- Reorder via drag.
- Edit caption and category.
- Publish/unpublish and delete.

### 6.4 Events Editor

**Route:** `/admin/cms/events`

- List view with upcoming/past grouping.
- Create/edit form: title, slug, description, event date, cover image upload, published status.
- Past events are automatically considered inactive for the public homepage.

### 6.5 Announcements Editor

**Route:** `/admin/cms/announcements`

- Table view with active/expired tabs.
- Create form: title, body, expiry date, published toggle.
- Active announcements display on the homepage banner and announcements section.

### 6.6 Social Links Editor

**Route:** `/admin/cms/social`

- Simple list of platforms with URL inputs.
- Toggle each link active/inactive.
- Predefined platforms: Instagram, Facebook, TikTok, YouTube, Twitter/X.

---

## 7. Content Validation Rules

| Content | Validation |
|---------|-----------|
| `venue.instapay_number` | Egyptian mobile format: 01[0-9]{9} |
| `venue.whatsapp` | International format: +20[0-9]+ |
| `venue.email` | Valid email format |
| `homepage.hero_image_key` | Must exist in storage; image MIME type |
| FAQ question | Min 5 chars, max 500 chars |
| FAQ answer | Min 10 chars, max 5000 chars |
| Event date | Must be a valid date; past events allowed (for archives) |
| Announcement expiry | Must be a future datetime if provided |
| Social link URL | Must be a valid HTTPS URL |
| Gallery image | Image MIME types only (JPEG, PNG, WEBP); max 5MB |

All CMS inputs are validated via Zod schemas before being written to the database. Validation errors are returned to the admin with field-level messages.

---

## 8. Cache Invalidation

When any CMS content is updated:

```typescript
// After successful CMS update in service:
await revalidateTag(`cms-${venueId}`)  // Next.js cache tag
```

This triggers Next.js to regenerate any cached RSC output that depends on CMS data. The page will be freshly rendered on the next request.

For static-like pages (About, FAQs) this means changes are visible on the next page load after the admin saves. There is no delay beyond normal page load time.

---

## 9. Content Security

- All CMS text fields that may render as HTML are escaped by default in React's JSX rendering.
- The "About" body field supports a restricted Markdown subset (bold, italic, headings, lists, links). Raw HTML is stripped server-side using a sanitizer (e.g., `sanitize-html` or `DOMPurify` server-side) before storage.
- Gallery images and hero images are served via the same access-controlled storage layer as other media.
- Public gallery images are granted read access (they are intentionally public). Payment proof images are strictly private.

---

## 10. Content Type Definitions (TypeScript)

```typescript
// src/modules/cms/cms.types.ts

export interface SiteSetting {
  id: string
  venueId: string
  key: string
  value: string | null
  valueType: 'text' | 'json' | 'boolean' | 'number'
  label: string
  groupName: string
  updatedAt: Date
}

export interface Faq {
  id: string
  venueId: string
  question: string
  answer: string
  displayOrder: number
  isPublished: boolean
  createdAt: Date
  updatedAt: Date
}

export interface GalleryItem {
  id: string
  venueId: string
  storageKey: string
  publicUrl: string   // derived at service layer, not stored
  caption: string | null
  category: string | null
  displayOrder: number
  isPublished: boolean
  createdAt: Date
}

export interface Event {
  id: string
  venueId: string
  title: string
  slug: string | null
  description: string | null
  eventDate: Date | null
  eventTime: string | null
  coverImageKey: string | null
  coverImageUrl: string | null  // derived
  isPublished: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Announcement {
  id: string
  venueId: string
  title: string
  body: string
  expiresAt: Date | null
  isPublished: boolean
  createdAt: Date
}

export interface SocialLink {
  id: string
  venueId: string
  platform: string
  url: string
  displayOrder: number
  isActive: boolean
}
```
