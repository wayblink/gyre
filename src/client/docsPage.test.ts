import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleDocPages } from './docsPage.js';

const LANGUAGES = ['zh-CN', 'en-US'] as const;

test('admins see the full manual including the admin-only Files and Workflow pages', () => {
  for (const language of LANGUAGES) {
    const ids = visibleDocPages(language, true).map((doc) => doc.id);
    assert.ok(ids.includes('files'), `${language}: files visible to admin`);
    assert.ok(ids.includes('workflow'), `${language}: workflow visible to admin`);
    assert.ok(ids.includes('overview'), `${language}: overview visible`);
  }
});

test('regular users never see admin-only doc pages', () => {
  for (const language of LANGUAGES) {
    const ids = visibleDocPages(language, false).map((doc) => doc.id);
    assert.ok(!ids.includes('files'), `${language}: files hidden from regular user`);
    assert.ok(!ids.includes('workflow'), `${language}: workflow hidden from regular user`);
    // The core manual stays available to everyone.
    assert.ok(ids.includes('overview'), `${language}: overview still visible`);
    assert.ok(ids.includes('monthly-flow'), `${language}: monthly flow still visible`);
    assert.ok(ids.includes('captable'), `${language}: captable still visible`);
    assert.ok(ids.includes('settings'), `${language}: settings still visible`);
  }
});

test('the Files & Workflow group disappears entirely for regular users', () => {
  const zhGroups = new Set(visibleDocPages('zh-CN', false).map((doc) => doc.group));
  assert.ok(!zhGroups.has('文件与工作流'), 'zh-CN: admin-only group removed');
  const enGroups = new Set(visibleDocPages('en-US', false).map((doc) => doc.group));
  assert.ok(!enGroups.has('Files & Workflow'), 'en-US: admin-only group removed');
});

test('hiding admin pages does not drop any non-admin page', () => {
  for (const language of LANGUAGES) {
    const all = visibleDocPages(language, true);
    const nonAdmin = visibleDocPages(language, false);
    const expected = all.filter((doc) => !doc.adminOnly).map((doc) => doc.id);
    assert.deepEqual(nonAdmin.map((doc) => doc.id), expected);
  }
});
