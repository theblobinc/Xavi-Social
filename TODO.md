# xavi_social Package - Fix & Improvement TODO List

## Critical Issues to Fix

### 1. UI/UX Structure Issues
- [ ] **Fix empty window on login** - Investigate [`/social/auth/login`](controllers/single_page/social/auth/login.php) redirect logic
  - Check window spawn behavior in taskbar.js
  - Review OAuth callback handling that may create phantom windows
  - Verify proper cleanup of popup/overlay states after login

- [ ] **Fix black background CSS issues**
  - Create proper dark theme variables in [`frontend/src/app.css`](frontend/src/app.css)
  - Ensure text contrast meets WCAG standards on dark backgrounds
  - Fix any hardcoded white backgrounds that clash with dark theme
  - Add CSS custom properties for theme switching

- [ ] **Restructure feed/timeline containers**
  - Wrap feed components in proper semantic containers (`<main>`, `<article>`, `<section>`)
  - Implement proper scrollable containers with overflow handling
  - Add loading skeletons for better perceived performance
  - Fix grid layout issues causing content overflow

### 2. Settings Panel Fixes
- [ ] **Fix Settings overlay functionality** 
  - Settings tabs (AppView, Social, Concrete) need proper content implementation
  - Fix tab persistence/restoration from localStorage
  - Implement actual settings controls instead of placeholders
  - Add user preference management (theme, notifications, privacy)

- [ ] **Consolidate settings locations**
  - Currently split between overlay and various panels
  - Create unified settings architecture
  - Implement settings sync across tabs/windows

### 3. Social Feed Improvements

#### Feed Container Structure
- [ ] **Create proper feed layout components**
  ```javascript
  // Components needed:
  - FeedContainer (main wrapper)
  - FeedHeader (with sort/filter controls)  
  - FeedList (scrollable post list)
  - FeedItem (individual post component)
  - FeedComposer (post creation)
  - FeedSidebar (trending, suggestions)
  ```

- [ ] **Implement feed sorting/filtering**
  - Add dropdown for: Latest, Top, Following, Trending
  - Implement feed algorithm selection
  - Add content type filters (text, media, replies)
  - Save user preferences

#### Timeline Enhancements
- [ ] **Fix timeline data flow**
  - Merge local cached posts with remote ATProto timeline properly
  - Implement proper cursor-based pagination
  - Fix duplicate post detection/merging
  - Add real-time updates via WebSocket/polling

- [ ] **Add timeline views**
  - Home timeline (following)
  - Discover/explore timeline
  - Notifications timeline
  - Profile timelines
  - List/custom feed timelines

### 4. ATProto Integration Fixes

- [ ] **OAuth flow improvements**
  - Fix callback handling to prevent empty windows
  - Implement proper error states
  - Add loading indicators during auth
  - Handle session refresh properly

- [ ] **PDS/AppView mode switching**
  - Currently hardcoded, needs dynamic switching
  - Add UI for selecting federation mode
  - Implement proper fallbacks when AppView unavailable

- [ ] **Post creation/interaction**
  - Fix post composer validation
  - Add rich text support
  - Implement mentions/hashtags
  - Add image/media upload
  - Fix reply threading

### 5. Component Architecture

- [ ] **Modernize component structure**
  - Migrate from jQuery-style DOM manipulation to modern framework
  - Consider React/Vue/Lit for component architecture
  - Implement proper state management (Redux/Zustand/Pinia)
  - Add TypeScript for better type safety

- [ ] **Fix module loading**
  - Consolidate duplicate module definitions
  - Fix circular dependencies
  - Implement proper lazy loading
  - Add module hot reloading for development

### 6. Database & Caching

- [ ] **PostgreSQL cache optimization**
  - Add proper indexes for feed queries
  - Implement cache invalidation strategy
  - Add background job for cache cleanup
  - Optimize upsert operations

- [ ] **Jetstream integration**
  - Fix ingestion pipeline reliability
  - Add error recovery/retry logic
  - Implement proper backpressure handling
  - Add monitoring/metrics

### 7. Multi-window/Tab Support

- [ ] **Fix workspace management**
  - Clean up orphaned workspace entries
  - Fix BroadcastChannel communication
  - Implement proper leader election for audio
  - Add window focus management

- [ ] **Settings sync across tabs**
  - Use localStorage events properly
  - Implement conflict resolution
  - Add debouncing for frequent updates

### 8. Visual Design Updates

- [ ] **Implement modern social UI patterns**
  - Card-based post layout
  - Floating action button for compose
  - Pull-to-refresh on mobile
  - Infinite scroll with loading indicators
  - Skeleton screens while loading

- [ ] **Fix responsive design**
  - Mobile-first approach
  - Proper breakpoints for tablets
  - Touch-friendly interaction targets
  - Swipe gestures for navigation

- [ ] **Dark mode improvements**
  - System preference detection
  - Smooth theme transitions
  - Proper color palette (not just inverted)
  - High contrast mode support

### 9. Performance Optimizations

- [ ] **Frontend performance**
  - Implement virtual scrolling for long feeds
  - Add image lazy loading
  - Optimize bundle size (code splitting)
  - Add service worker for offline support
  - Implement proper caching strategies

- [ ] **Backend performance**
  - Add Redis for session/cache storage
  - Implement query result caching
  - Add CDN for static assets
  - Optimize database queries

### 10. Security & Privacy

- [ ] **Security improvements**
  - Implement CSRF protection properly
  - Add rate limiting for API endpoints
  - Sanitize user-generated content
  - Implement Content Security Policy

- [ ] **Privacy features**
  - Add block/mute functionality  
  - Implement privacy settings
  - Add GDPR compliance features
  - Implement data export functionality

### 11. Testing & Documentation

- [ ] **Add test coverage**
  - Unit tests for API endpoints
  - Integration tests for ATProto
  - E2E tests for critical flows
  - Performance benchmarks

- [ ] **Update documentation**
  - API documentation
  - Component documentation
  - Deployment guide
  - User guide

### 12. Specific File Fixes

#### frontend/src/main.js
- [ ] Refactor monolithic renderApp function
- [ ] Extract API client to separate module
- [ ] Implement proper error boundaries
- [ ] Add retry logic for failed requests

#### taskbar.js
- [ ] Remove legacy playlist code
- [ ] Simplify settings overlay management  
- [ ] Fix memory leaks from event listeners
- [ ] Consolidate duplicate overlay logic

#### controller.php
- [ ] Add proper route versioning
- [ ] Implement middleware for auth/cors
- [ ] Add request validation
- [ ] Improve error responses

### 13. New Features to Consider

- [ ] **Social features**
  - Direct messages
  - Groups/communities  
  - Events
  - Polls
  - Live streaming

- [ ] **Discovery features**
  - Trending topics
  - Recommended users
  - Content recommendations
  - Search improvements

- [ ] **Engagement features**
  - Reactions beyond likes
  - Quote posts
  - Bookmarks
  - Draft posts

### 14. Migration Path

- [ ] **Gradual refactoring approach**
  1. Fix critical bugs first
  2. Improve existing components
  3. Add new features incrementally
  4. Migrate to modern framework gradually
  5. Maintain backwards compatibility

### 15. Development Workflow

- [ ] **Improve developer experience**
  - Add hot module replacement
  - Implement proper build pipeline
  - Add linting/formatting
  - Create development seeds
  - Add debugging tools

## Priority Order

### Phase 1 - Critical Fixes (Week 1-2)
1. Fix empty window on login
2. Fix black background CSS
3. Fix Settings panel
4. Restructure feed containers

### Phase 2 - Core Improvements (Week 3-4)
1. Implement proper feed sorting
2. Fix timeline data flow
3. Add loading states
4. Fix responsive design

### Phase 3 - Enhancement (Week 5-6)
1. Add new timeline views
2. Improve post composer
3. Add real-time updates
4. Implement search

### Phase 4 - Polish (Week 7-8)
1. Performance optimizations
2. Add tests
3. Update documentation
4. Security audit

## Configuration Needed

```env
# Add to .env
XAVI_SOCIAL_THEME=dark
XAVI_SOCIAL_FEED_CACHE_TTL=300
XAVI_SOCIAL_REALTIME_ENABLED=true
XAVI_SOCIAL_DEBUG_MODE=false
```

## Database Migrations Needed

```sql
-- Add indexes for performance
CREATE INDEX idx_cached_posts_created_at ON xavi_social_cached_posts(created_at DESC);
CREATE INDEX idx_cached_posts_author_did ON xavi_social_cached_posts(author_did);

-- Add user preferences table
CREATE TABLE xavi_social_user_preferences (
    user_id INT PRIMARY KEY,
    theme VARCHAR(20) DEFAULT 'dark',
    feed_algorithm VARCHAR(50) DEFAULT 'reverse-chronological',
    notifications_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Notes

- The project has good bones but needs modernization
- Consider progressive enhancement approach
- Keep ATProto compatibility as priority
- Maintain ConcreteCMS integration patterns
- Focus on user experience over features