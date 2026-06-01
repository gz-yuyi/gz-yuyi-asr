import { $, qsa } from '../core/dom.js';
import { apiErrorMessage, dataOrNull, httpBinary, httpJson, summarizeHttpResponse } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { buildQuery, esc, pretty, speakerMsText, speakerScoreText } from '../core/format.js';
import { toast } from '../core/toast.js';

function speakerProfileId() {
  return $('speakerProfileId').value.trim();
}

function setIfElement(id, value) {
  const el = $(id);
  if (el) el.value = value || '';
}

function fillProfileIdentity(profileId, speakerName) {
  if (profileId) {
    setIfElement('speakerProfileId', profileId);
    setIfElement('speakerEnrollProfileId', profileId);
  }
  if (speakerName) {
    setIfElement('speakerName', speakerName);
    setIfElement('speakerEnrollName', speakerName);
  }
}

function speakerBasePayload() {
  const payload = {};
  const profileId = speakerProfileId();
  const speakerName = $('speakerName').value.trim();
  const description = $('speakerDescription').value.trim();
  const groupId = $('speakerGroupId').value.trim();
  const groupName = $('speakerGroupName').value.trim();
  if (profileId) payload.SpeakerProfileId = profileId;
  if (speakerName) payload.SpeakerName = speakerName;
  if (description) payload.Description = description;
  if (groupId) payload.GroupId = groupId;
  if (groupName) payload.GroupName = groupName;
  return payload;
}

function renderEnrollmentSummary(item) {
  const parts = [];
  if (item?.EffectiveSpeechMs != null) parts.push(`speech=${speakerMsText(item.EffectiveSpeechMs)}`);
  if (item?.QualityScore != null) parts.push(`quality=${speakerScoreText(item.QualityScore)}`);
  if (item?.CreatedAt) parts.push(`created=${item.CreatedAt}`);
  return parts.length ? parts.join(' · ') : '无更多信息';
}

function profileFromResponse(res) {
  const data = dataOrNull(res);
  if (!data) return null;
  if (data.SpeakerProfileId) return data;
  if (data.Profile?.SpeakerProfileId) return data.Profile;
  return null;
}

function fillSpeakerForm(profile) {
  if (!profile) return;
  fillProfileIdentity(profile.SpeakerProfileId, profile.SpeakerName);
  $('speakerDescription').value = profile.Description || '';
  $('speakerStatus').value = profile.Status || '';
  const groups = Array.isArray(profile.Groups) ? profile.Groups : [];
  if (groups[0]?.GroupId) $('speakerGroupId').value = groups[0].GroupId;
  if (groups[0]?.GroupName) $('speakerGroupName').value = groups[0].GroupName;
}

function renderProfileGroups(groups) {
  const items = Array.isArray(groups) ? groups : [];
  if (!items.length) return 'Groups: -';
  return `Groups: ${items.map(group => `${group.GroupName || group.GroupId || '-'}(${group.GroupId || '-'})`).join(', ')}`;
}

function renderEnrollmentList(enrollments) {
  if (!Array.isArray(enrollments) || !enrollments.length) {
    return '<div class="profile-sub">暂无 enrollment</div>';
  }
  return `
        <div class="enrollment-list">
          ${enrollments.map(item => `
            <div class="enrollment-item">
              <div class="profile-sub">
                <div><span class="mono">${esc(item.EnrollmentId || '-')}</span></div>
                <div>${esc(renderEnrollmentSummary(item))}</div>
              </div>
              <button class="btn-ghost use-enrollment-btn" data-enrollment-id="${esc(item.EnrollmentId || '')}">填入删除框</button>
            </div>
          `).join('')}
        </div>
      `;
}

function renderSpeakerProfiles(items) {
  const profiles = Array.isArray(items) ? items : [];
  if (!profiles.length) {
    $('speakerProfilesList').innerHTML = '<div class="empty-state">没有匹配的声纹 Profile</div>';
    return;
  }
  $('speakerProfilesList').innerHTML = profiles.map(profile => {
    const enrollments = Array.isArray(profile.Enrollments) ? profile.Enrollments : [];
    return `
          <div class="profile-card">
            <div class="profile-head">
              <div class="profile-title">${esc(profile.SpeakerName || '-')}</div>
              <span class="match-badge ${esc(profile.Status || '')}">${esc(profile.Status || '-')}</span>
            </div>
            <div class="profile-sub">
              <div>ProfileId: <span class="mono">${esc(profile.SpeakerProfileId || '-')}</span></div>
              <div>${esc(renderProfileGroups(profile.Groups))}</div>
              <div>Enrollments: ${esc(profile.EnrollmentCount ?? enrollments.length ?? 0)}</div>
              ${profile.Description ? `<div>${esc(profile.Description)}</div>` : ''}
            </div>
            <div class="btn-row">
              <button class="btn-ghost use-profile-btn" data-profile-id="${esc(profile.SpeakerProfileId || '')}">填入表单</button>
            </div>
            ${renderEnrollmentList(enrollments)}
          </div>
        `;
  }).join('');
  qsa('#speakerProfilesList .use-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => loadSpeakerProfile(btn.dataset.profileId));
  });
  qsa('#speakerProfilesList .use-enrollment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('speakerEnrollmentId').value = btn.dataset.enrollmentId || '';
    });
  });
}

function logSpeakerResponse(res, action) {
  const logEl = $('speakerLog');
  appendLog(logEl, `${action}: ${summarizeHttpResponse(res)}`, res.ok ? 'log-recv' : 'log-err', 'info');
  appendLogRaw(logEl, pretty(res.json || res.text), res.ok ? 'log-recv' : 'log-err', 'debug');
  if (!res.ok || res?.json?.Response?.Error) {
    throw new Error(apiErrorMessage(res));
  }
}

export async function listSpeakerProfiles() {
  const query = buildQuery({
    GroupId: $('speakerGroupId').value.trim() || 'default',
    Status: $('speakerListStatus').value,
    Limit: Math.max(1, Math.min(200, Number($('speakerListLimit').value || 50))),
    Offset: Math.max(0, Number($('speakerListOffset').value || 0)),
  });
  try {
    const res = await httpJson(`/api/speakers/list${query}`);
    logSpeakerResponse(res, '列出 Profile');
    const data = dataOrNull(res) || {};
    renderSpeakerProfiles(data.Items || []);
    toast(`已加载 ${data.Total ?? (data.Items || []).length} 个 Profile`, 'success');
  } catch (err) {
    $('speakerProfilesList').innerHTML = `<div class="empty-state">加载失败: ${esc(err.message)}</div>`;
    toast(`声纹列表加载失败: ${err.message}`, 'error');
  }
}

async function loadSpeakerProfile(profileId = speakerProfileId()) {
  const safeId = String(profileId || '').trim();
  if (!safeId) {
    toast('请填写 SpeakerProfileId', 'error');
    return;
  }
  try {
    const res = await httpJson(`/api/speakers/get${buildQuery({
      SpeakerProfileId: safeId,
      GroupId: $('speakerGroupId').value.trim(),
    })}`);
    logSpeakerResponse(res, '查询 Profile');
    const profile = profileFromResponse(res);
    fillSpeakerForm(profile);
    renderSpeakerProfiles(profile ? [profile] : []);
    toast('Profile 已加载', 'success');
  } catch (err) {
    appendLog($('speakerLog'), `查询失败: ${err.message}`, 'log-err', 'error');
    toast(`查询失败: ${err.message}`, 'error');
  }
}

async function createSpeakerProfile() {
  const body = speakerBasePayload();
  if (!body.SpeakerName) {
    toast('请填写 SpeakerName', 'error');
    return;
  }
  try {
    const res = await httpJson('/api/speakers/create', { method: 'POST', body });
    logSpeakerResponse(res, '创建 Profile');
    const profile = profileFromResponse(res);
    fillSpeakerForm(profile);
    renderSpeakerProfiles(profile ? [profile] : []);
    toast('Profile 已创建', 'success');
  } catch (err) {
    appendLog($('speakerLog'), `创建失败: ${err.message}`, 'log-err', 'error');
    toast(`创建失败: ${err.message}`, 'error');
  }
}

async function updateSpeakerProfile() {
  const body = speakerBasePayload();
  const status = $('speakerStatus').value;
  if (!body.SpeakerProfileId) {
    toast('请填写 SpeakerProfileId', 'error');
    return;
  }
  if (status) body.Status = status;
  try {
    const res = await httpJson('/api/speakers/update', { method: 'POST', body });
    logSpeakerResponse(res, '更新 Profile');
    const profile = profileFromResponse(res);
    fillSpeakerForm(profile);
    renderSpeakerProfiles(profile ? [profile] : []);
    toast('Profile 已更新', 'success');
  } catch (err) {
    appendLog($('speakerLog'), `更新失败: ${err.message}`, 'log-err', 'error');
    toast(`更新失败: ${err.message}`, 'error');
  }
}

async function deleteSpeakerProfile() {
  const profileId = speakerProfileId();
  if (!profileId) {
    toast('请填写 SpeakerProfileId', 'error');
    return;
  }
  try {
    const res = await httpJson('/api/speakers/delete', {
      method: 'POST',
      body: {
        SpeakerProfileId: profileId,
        HardDelete: $('speakerHardDelete').checked,
      },
    });
    logSpeakerResponse(res, '删除 Profile');
    toast('删除请求已完成', 'success');
    await listSpeakerProfiles();
  } catch (err) {
    appendLog($('speakerLog'), `删除失败: ${err.message}`, 'log-err', 'error');
    toast(`删除失败: ${err.message}`, 'error');
  }
}

function speakerEnrollPayload() {
  const payload = {};
  const profileId = $('speakerEnrollProfileId').value.trim() || speakerProfileId();
  const speakerName = $('speakerEnrollName').value.trim() || $('speakerName').value.trim();
  const description = $('speakerDescription').value.trim();
  const groupId = $('speakerGroupId').value.trim();
  const groupName = $('speakerGroupName').value.trim();
  if (profileId) payload.SpeakerProfileId = profileId;
  if (speakerName) payload.SpeakerName = speakerName;
  if (description) payload.Description = description;
  if (groupId) payload.GroupId = groupId;
  if (groupName) payload.GroupName = groupName;
  payload.AutoCreate = $('speakerEnrollAutoCreate').checked;
  return payload;
}

function validateSpeakerEnrollmentPayload(payload) {
  if (!payload.SpeakerProfileId) {
    toast('请填写注册用 SpeakerProfileId', 'error');
    $('speakerEnrollProfileId').focus();
    return false;
  }
  if (payload.AutoCreate && !payload.SpeakerName) {
    toast('AutoCreate 开启时请填写 SpeakerName', 'error');
    $('speakerEnrollName').focus();
    return false;
  }
  return true;
}

function rememberEnrollment(res) {
  const data = dataOrNull(res);
  const enrollmentId = data?.EnrollmentId;
  if (enrollmentId) $('speakerEnrollmentId').value = enrollmentId;
  fillProfileIdentity(data?.SpeakerProfileId, data?.SpeakerName);
}

function updateSpeakerEnrollUploadStatus() {
  const file = $('speakerEnrollFile').files[0];
  $('speakerEnrollUploadStatus').value = file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : '未选择文件';
}

async function uploadSpeakerEnrollment() {
  const file = $('speakerEnrollFile').files[0];
  const base = speakerEnrollPayload();
  if (!file) {
    toast('请先选择注册音频', 'error');
    return;
  }
  if (!validateSpeakerEnrollmentPayload(base)) {
    return;
  }
  fillProfileIdentity(base.SpeakerProfileId, base.SpeakerName);
  const query = buildQuery({
    SpeakerProfileId: base.SpeakerProfileId,
    SpeakerName: base.SpeakerName,
    AutoCreate: base.AutoCreate,
    Description: base.Description,
    GroupId: base.GroupId,
    GroupName: base.GroupName,
    Filename: file.name,
  });
  try {
    $('speakerEnrollUploadStatus').value = '上传注册中...';
    appendLog($('speakerLog'), `上传注册声纹: ${file.name} (${file.size} bytes)`, 'log-sent', 'info');
    const res = await httpBinary(`/api/speakers/enroll_upload${query}`, {
      body: file,
      contentType: file.type || 'application/octet-stream',
    });
    logSpeakerResponse(res, '上传注册');
    rememberEnrollment(res);
    $('speakerEnrollUploadStatus').value = '已注册';
    toast('声纹已注册', 'success');
    await loadSpeakerProfile(base.SpeakerProfileId);
  } catch (err) {
    $('speakerEnrollUploadStatus').value = '注册失败';
    appendLog($('speakerLog'), `上传注册失败: ${err.message}`, 'log-err', 'error');
    toast(`注册失败: ${err.message}`, 'error');
  }
}

async function pathSpeakerEnrollment() {
  const body = speakerEnrollPayload();
  body.SourceType = Number($('speakerEnrollSourceType').value);
  const url = $('speakerEnrollUrl').value.trim();
  const extra = $('speakerEnrollExtra').value.trim();
  if (url) body.Url = url;
  if (extra) body.Extra = extra;
  if (!validateSpeakerEnrollmentPayload(body)) {
    return;
  }
  fillProfileIdentity(body.SpeakerProfileId, body.SpeakerName);
  if (body.SourceType === 0 && !body.Url) {
    toast('SourceType=0 时请填写 Url', 'error');
    return;
  }
  if (body.SourceType === 1 && !body.Extra) {
    toast('SourceType=1 时请填写 Extra', 'error');
    return;
  }
  try {
    appendLog($('speakerLog'), 'URL / 本地路径注册声纹...', 'log-sent', 'info');
    const res = await httpJson('/api/speakers/enroll', { method: 'POST', body });
    logSpeakerResponse(res, 'URL / 本地路径注册');
    rememberEnrollment(res);
    toast('声纹已注册', 'success');
    await loadSpeakerProfile(body.SpeakerProfileId);
  } catch (err) {
    appendLog($('speakerLog'), `注册失败: ${err.message}`, 'log-err', 'error');
    toast(`注册失败: ${err.message}`, 'error');
  }
}

async function deleteSpeakerEnrollment() {
  const enrollmentId = $('speakerEnrollmentId').value.trim();
  if (!enrollmentId) {
    toast('请填写 EnrollmentId', 'error');
    return;
  }
  try {
    const res = await httpJson('/api/speakers/delete_enrollment', {
      method: 'POST',
      body: { EnrollmentId: enrollmentId },
    });
    logSpeakerResponse(res, '删除 Enrollment');
    toast('Enrollment 已删除', 'success');
    if (speakerProfileId()) await loadSpeakerProfile();
  } catch (err) {
    appendLog($('speakerLog'), `删除 enrollment 失败: ${err.message}`, 'log-err', 'error');
    toast(`删除失败: ${err.message}`, 'error');
  }
}

export function registerSpeakers() {
  $('speakerEnrollFile').addEventListener('change', updateSpeakerEnrollUploadStatus);
  $('createSpeakerBtn').addEventListener('click', createSpeakerProfile);
  $('getSpeakerBtn').addEventListener('click', () => loadSpeakerProfile());
  $('listSpeakersBtn').addEventListener('click', listSpeakerProfiles);
  $('updateSpeakerBtn').addEventListener('click', updateSpeakerProfile);
  $('deleteSpeakerBtn').addEventListener('click', deleteSpeakerProfile);
  $('uploadSpeakerEnrollBtn').addEventListener('click', uploadSpeakerEnrollment);
  $('pathSpeakerEnrollBtn').addEventListener('click', pathSpeakerEnrollment);
  $('deleteSpeakerEnrollmentBtn').addEventListener('click', deleteSpeakerEnrollment);
  $('clearSpeakerLogBtn').addEventListener('click', () => { $('speakerLog').innerHTML = ''; });

  return { listSpeakerProfiles };
}
