import { $, qsa } from '../core/dom.js';
import { apiErrorMessage, dataOrNull, httpBinary, httpJson, summarizeHttpResponse } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { buildQuery, esc, pretty, speakerMsText, speakerScoreText } from '../core/format.js';
import { toast } from '../core/toast.js';

function speakerProfileId() {
  return $('speakerProfileId').value.trim();
}

function speakerLookupProfileId() {
  return $('speakerProfileSearchId').value.trim() || speakerProfileId();
}

function speakerFilterGroupId() {
  return $('speakerFilterGroupId').value.trim() || 'default';
}

function setIfElement(id, value) {
  const el = $(id);
  if (el) el.value = value || '';
}

function fillProfileIdentity(profileId, speakerName) {
  if (profileId) {
    setIfElement('speakerProfileId', profileId);
    setIfElement('speakerProfileSearchId', profileId);
    setIfElement('speakerEnrollProfileId', profileId);
  }
  if (speakerName) {
    setIfElement('speakerName', speakerName);
    setIfElement('speakerEnrollName', speakerName);
  }
  updateSpeakerContext();
}

function speakerLabel(profileId = speakerProfileId(), speakerName = $('speakerName').value.trim()) {
  if (!profileId) return '当前未选择人员';
  return `${speakerName || '未命名'} / ${profileId}`;
}

function updateSpeakerContext() {
  const profileId = speakerProfileId();
  const speakerName = $('speakerName').value.trim();
  $('speakerCurrentProfile').textContent = speakerLabel(profileId, speakerName);
  $('speakerEnrollTargetText').textContent = profileId
    ? `音频会注册到 ${speakerLabel(profileId, speakerName)}`
    : '先从列表选择人员，或创建人员后再上传音频';
  setIfElement('speakerEnrollProfileId', profileId);
  setIfElement('speakerEnrollName', speakerName);
}

function setSpeakerEditorMode(mode) {
  const isCreate = mode === 'create';
  $('speakerProfileId').readOnly = !isCreate;
  $('createSpeakerBtn').classList.toggle('hidden', !isCreate);
  $('updateSpeakerBtn').classList.toggle('hidden', isCreate);
  $('deleteSpeakerBtn').classList.toggle('hidden', isCreate);
  $('speakerEditorHint').textContent = isCreate
    ? '新增人员时只需要填写姓名；人员 ID 可留空由服务端生成'
    : '正在编辑当前人员；人员 ID 保持只读，避免误改身份';
}

function startCreateSpeakerProfile() {
  setSpeakerEditorMode('create');
  setIfElement('speakerProfileId', '');
  setIfElement('speakerProfileSearchId', '');
  setIfElement('speakerName', '');
  setIfElement('speakerDescription', '');
  setIfElement('speakerStatus', 'active');
  setIfElement('speakerGroupId', speakerFilterGroupId());
  setIfElement('speakerGroupName', '');
  setIfElement('speakerEnrollProfileId', '');
  setIfElement('speakerEnrollName', '');
  $('speakerEnrollAutoCreate').checked = false;
  $('speakerHardDelete').checked = false;
  updateSpeakerContext();
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
  setSpeakerEditorMode('edit');
  fillProfileIdentity(profile.SpeakerProfileId, profile.SpeakerName);
  $('speakerDescription').value = profile.Description || '';
  $('speakerStatus').value = profile.Status || 'active';
  const groups = Array.isArray(profile.Groups) ? profile.Groups : [];
  if (groups[0]?.GroupId) $('speakerGroupId').value = groups[0].GroupId;
  if (groups[0]?.GroupName) $('speakerGroupName').value = groups[0].GroupName;
  updateSpeakerContext();
}

function renderProfileGroups(groups) {
  const items = Array.isArray(groups) ? groups : [];
  if (!items.length) return 'Groups: -';
  return `Groups: ${items.map(group => `${group.GroupName || group.GroupId || '-'}(${group.GroupId || '-'})`).join(', ')}`;
}

function renderEnrollmentList(enrollments, profileId = '') {
  if (!Array.isArray(enrollments) || !enrollments.length) {
    return '<div class="profile-sub">暂无声纹样本</div>';
  }
  return `
        <div class="enrollment-list">
          ${enrollments.map(item => `
            <div class="enrollment-item">
              <div class="profile-sub">
                <div><span class="mono">${esc(item.EnrollmentId || '-')}</span></div>
                <div>${esc(renderEnrollmentSummary(item))}</div>
              </div>
              <button class="btn-danger delete-enrollment-item-btn" data-profile-id="${esc(profileId)}" data-enrollment-id="${esc(item.EnrollmentId || '')}">删除样本</button>
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
    const profileId = profile.SpeakerProfileId || '';
    const nextStatus = profile.Status === 'disabled' ? 'active' : 'disabled';
    const toggleLabel = profile.Status === 'disabled' ? '启用' : '禁用';
    return `
          <div class="profile-card">
            <div class="profile-head">
              <div class="profile-title">${esc(profile.SpeakerName || '-')}</div>
              <span class="match-badge ${esc(profile.Status || '')}">${esc(profile.Status || '-')}</span>
            </div>
            <div class="profile-sub">
              <div>ProfileId: <span class="mono">${esc(profileId || '-')}</span></div>
              <div>${esc(renderProfileGroups(profile.Groups))}</div>
              <div>样本数: ${esc(profile.EnrollmentCount ?? enrollments.length ?? 0)}</div>
              ${profile.Description ? `<div>${esc(profile.Description)}</div>` : ''}
            </div>
            <div class="btn-row profile-actions">
              <button class="btn-primary open-profile-btn" data-profile-id="${esc(profileId)}">查看详情</button>
              <button class="btn-success enroll-profile-btn" data-profile-id="${esc(profileId)}">注册声纹</button>
              <button class="btn-ghost toggle-profile-btn" data-profile-id="${esc(profileId)}" data-next-status="${esc(nextStatus)}">${toggleLabel}</button>
              <button class="btn-danger delete-profile-item-btn" data-profile-id="${esc(profileId)}">删除</button>
            </div>
            ${renderEnrollmentList(enrollments, profileId)}
          </div>
        `;
  }).join('');
  qsa('#speakerProfilesList .open-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => loadSpeakerProfile(btn.dataset.profileId));
  });
  qsa('#speakerProfilesList .enroll-profile-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await loadSpeakerProfile(btn.dataset.profileId);
      $('speakerEnrollFile').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('speakerEnrollFile').focus();
    });
  });
  qsa('#speakerProfilesList .toggle-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => quickUpdateSpeakerStatus(btn.dataset.profileId, btn.dataset.nextStatus));
  });
  qsa('#speakerProfilesList .delete-profile-item-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSpeakerProfile(btn.dataset.profileId));
  });
  qsa('#speakerProfilesList .delete-enrollment-item-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSpeakerEnrollment(btn.dataset.enrollmentId, btn.dataset.profileId));
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
    GroupId: speakerFilterGroupId(),
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

async function loadSpeakerProfile(profileId = speakerLookupProfileId()) {
  const safeId = String(profileId || '').trim();
  if (!safeId) {
    toast('请填写或选择人员 ID', 'error');
    $('speakerProfileSearchId').focus();
    return;
  }
  try {
    const res = await httpJson(`/api/speakers/get${buildQuery({
      SpeakerProfileId: safeId,
      GroupId: speakerFilterGroupId(),
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
    toast('请填写姓名', 'error');
    $('speakerName').focus();
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
    toast('请先选择人员', 'error');
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

async function quickUpdateSpeakerStatus(profileId, status) {
  const safeId = String(profileId || '').trim();
  if (!safeId || !status) return;
  try {
    const res = await httpJson('/api/speakers/update', {
      method: 'POST',
      body: { SpeakerProfileId: safeId, Status: status },
    });
    logSpeakerResponse(res, status === 'active' ? '启用 Profile' : '禁用 Profile');
    toast(status === 'active' ? '人员已启用' : '人员已禁用', 'success');
    if (speakerProfileId() === safeId) {
      const profile = profileFromResponse(res);
      if (profile) fillSpeakerForm(profile);
    }
    await listSpeakerProfiles();
  } catch (err) {
    appendLog($('speakerLog'), `状态更新失败: ${err.message}`, 'log-err', 'error');
    toast(`状态更新失败: ${err.message}`, 'error');
  }
}

async function deleteSpeakerProfile(profileId = speakerProfileId()) {
  const safeId = String(profileId || '').trim();
  if (!safeId) {
    toast('请先选择人员', 'error');
    return;
  }
  if (!window.confirm(`确认删除人员 ${safeId}？`)) return;
  try {
    const res = await httpJson('/api/speakers/delete', {
      method: 'POST',
      body: {
        SpeakerProfileId: safeId,
        HardDelete: $('speakerHardDelete').checked,
      },
    });
    logSpeakerResponse(res, '删除 Profile');
    toast('删除请求已完成', 'success');
    if (speakerProfileId() === safeId) startCreateSpeakerProfile();
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
    toast('请先选择或创建人员', 'error');
    $('speakerName').focus();
    return false;
  }
  if (payload.AutoCreate && !payload.SpeakerName) {
    toast('自动创建人员时请填写姓名', 'error');
    $('speakerName').focus();
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

async function deleteSpeakerEnrollment(enrollmentId = $('speakerEnrollmentId').value.trim(), profileId = speakerProfileId()) {
  const safeId = String(enrollmentId || '').trim();
  if (!safeId) {
    toast('请选择要删除的声纹样本', 'error');
    return;
  }
  if (!window.confirm(`确认删除声纹样本 ${safeId}？`)) return;
  try {
    const res = await httpJson('/api/speakers/delete_enrollment', {
      method: 'POST',
      body: { EnrollmentId: safeId },
    });
    logSpeakerResponse(res, '删除声纹样本');
    toast('声纹样本已删除', 'success');
    if (profileId) await loadSpeakerProfile(profileId);
    else await listSpeakerProfiles();
  } catch (err) {
    appendLog($('speakerLog'), `删除 enrollment 失败: ${err.message}`, 'log-err', 'error');
    toast(`删除失败: ${err.message}`, 'error');
  }
}

export function registerSpeakers() {
  $('speakerEnrollFile').addEventListener('change', updateSpeakerEnrollUploadStatus);
  $('newSpeakerBtn').addEventListener('click', startCreateSpeakerProfile);
  $('speakerProfileId').addEventListener('input', updateSpeakerContext);
  $('speakerName').addEventListener('input', updateSpeakerContext);
  $('createSpeakerBtn').addEventListener('click', createSpeakerProfile);
  $('getSpeakerBtn').addEventListener('click', () => loadSpeakerProfile());
  $('listSpeakersBtn').addEventListener('click', listSpeakerProfiles);
  $('updateSpeakerBtn').addEventListener('click', updateSpeakerProfile);
  $('deleteSpeakerBtn').addEventListener('click', () => deleteSpeakerProfile());
  $('uploadSpeakerEnrollBtn').addEventListener('click', uploadSpeakerEnrollment);
  $('pathSpeakerEnrollBtn').addEventListener('click', pathSpeakerEnrollment);
  $('deleteSpeakerEnrollmentBtn').addEventListener('click', () => deleteSpeakerEnrollment());
  $('clearSpeakerLogBtn').addEventListener('click', () => { $('speakerLog').innerHTML = ''; });
  startCreateSpeakerProfile();

  return { listSpeakerProfiles };
}
