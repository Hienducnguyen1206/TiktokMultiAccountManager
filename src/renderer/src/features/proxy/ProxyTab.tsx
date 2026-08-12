import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Flag } from '../../components/Flag'
import { GroupMark } from '../../components/GroupMark'
import { NO_GROUP } from '../../components/groupStyle'
import { Select } from '../../components/Select'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import { MACHINE_PROXY_ID, type MachineIp, type Profile, type Proxy, type ProxyType } from '@shared/types'

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (n: number) => void }): JSX.Element {
  const [text, setText] = useState('')
  const [type, setType] = useState<ProxyType>('http')
  const add = async (): Promise<void> => {
    const n = await window.hnv.proxies.addMany(text, type)
    onAdded(n)
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">+ Thêm proxy vào pool</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">
            <Icon name="close" filled size={18} className="inline align-[-3px]" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-subtle">Loại:</span>
            <Select
              className="w-[140px]"
              value={type}
              onChange={(v) => setType(v as ProxyType)}
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'https', label: 'HTTPS' },
                { value: 'socks5', label: 'SOCKS5' },
              ]}
            />
          </div>
          <div>
            <div className="text-[13px] text-subtle mb-1.5">
              Mỗi dòng 1 proxy: <code className="text-accent2">host:port:user:pass</code> (user:pass tùy chọn)
            </div>
            <textarea
              className="inp h-[180px] resize-none font-mono text-[13px]"
              placeholder={'104.28.10.5:8080:user:pass\n45.12.34.56:3128'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
          <button
            onClick={onClose}
            className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]"
          >
            Hủy
          </button>
          <button
            onClick={add}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px]"
          >
            Thêm
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignDialog({
  proxy,
  onClose,
  onAssigned,
}: {
  proxy: Proxy
  onClose: () => void
  onAssigned: () => void
}): JSX.Element {
  const isMachine = proxy.id === MACHINE_PROXY_ID
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  useEffect(() => {
    window.hnv.profiles.list().then((ps) => {
      setProfiles(ps)
      // Máy thật: chọn sẵn profile đang KHÔNG dùng proxy. Proxy thường: profile đang dùng nó.
      setPicked(new Set(ps.filter((p) => (isMachine ? !p.proxyId : p.proxyId === proxy.id)).map((p) => p.id)))
    })
  }, [proxy.id, isMachine])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
  }, [profiles, q])

  /** Gom theo nhóm, "Không nhóm" xuống cuối — cùng cách sắp xếp với tab Hồ sơ và
   *  bảng chọn của tab Kịch bản, để ba nơi đọc như nhau. */
  const sections = useMemo(() => {
    const byGroup = new Map<string, Profile[]>()
    for (const p of filtered) {
      const key = p.groupId ?? NO_GROUP
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(p)
    }
    const named = [...byGroup.entries()]
      .filter(([k]) => k !== NO_GROUP)
      .sort((a, b) => (a[1][0].groupName ?? '').localeCompare(b[1][0].groupName ?? '', 'vi'))
    const loose = byGroup.get(NO_GROUP)
    return [
      ...named.map(([key, items]) => ({ key, items, head: items[0] as Profile | null })),
      ...(loose ? [{ key: NO_GROUP, items: loose, head: null }] : []),
    ]
  }, [filtered])

  const toggle = (id: string): void =>
    setPicked((cur) => {
      const n = new Set(cur)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  /** Bấm vào nhóm: còn thiếu ai thì chọn hết, đủ cả rồi thì bỏ hết. */
  const toggleGroup = (items: Profile[]): void =>
    setPicked((cur) => {
      const n = new Set(cur)
      const all = items.every((p) => n.has(p.id))
      for (const p of items) all ? n.delete(p.id) : n.add(p.id)
      return n
    })

  const apply = async (): Promise<void> => {
    await window.hnv.proxies.assign(proxy.id, [...picked])
    onAssigned()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[520px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[16px] font-bold">
            {isMachine ? (
              <>
                Đặt về{' '}
                <span className="text-accent2">
                  <Icon name="monitor" filled size={15} className="inline align-[-3px] mr-1" />
                  IP máy thật (không proxy)
                </span>
              </>
            ) : (
              <>
                Gán proxy{' '}
                <span className="text-accent2">
                  {proxy.host}:{proxy.port}
                </span>
              </>
            )}
          </div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">
            <Icon name="close" filled size={18} className="inline align-[-3px]" />
          </button>
        </div>
        <div className="p-4">
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              <Icon
                name="search"
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input className="inp pl-9" placeholder="Tìm hồ sơ…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {(() => {
              const allOn = filtered.length > 0 && filtered.every((p) => picked.has(p.id))
              return (
                <button
                  onClick={() =>
                    setPicked((cur) => {
                      const n = new Set(cur)
                      if (allOn) filtered.forEach((p) => n.delete(p.id))
                      else filtered.forEach((p) => n.add(p.id))
                      return n
                    })
                  }
                  className="shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-accent2 border border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.18),rgba(34,211,238,.10))]"
                >
                  {allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
              )
            })()}
          </div>
          {/* Xếp theo nhóm và cho bấm cả nhóm một nhát. Gán proxy vốn làm theo
              nhóm — cả nhóm thường dùng chung một dải IP — mà trước đây phải tích
              từng hồ sơ một, dễ bỏ sót đúng cái vừa thêm vào nhóm.

              Dấu "–" trên ô nhóm nghĩa là chọn một phần: bấm lần nữa thì chọn
              nốt, không phải bỏ hết. */}
          <div className="h-[300px] overflow-y-auto hv-scroll text-[13px]">
            {sections.map((sec) => {
              const ids = sec.items.map((p) => p.id)
              const onCount = ids.filter((id) => picked.has(id)).length
              const all = onCount === ids.length && ids.length > 0
              const some = onCount > 0 && !all
              return (
                <div key={sec.key} className="mb-1">
                  <div
                    onClick={() => toggleGroup(sec.items)}
                    className="flex items-center py-2 px-2 rounded-lg cursor-pointer select-none bg-[#12131b] hover:bg-[#161822]"
                  >
                    <span
                      className={
                        'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black shrink-0 ' +
                        (all || some ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')
                      }
                    >
                      {all ? <Icon name="check" filled size={14} className="inline align-[-3px]" /> : some ? '–' : ''}
                    </span>
                    <span className="ml-2.5 flex items-center gap-1.5 font-semibold min-w-0">
                      <GroupMark icon={sec.head?.groupIcon} color={sec.head?.groupColor} />
                      <span className={'truncate ' + (sec.head ? '' : 'text-subtle')}>
                        {sec.head?.groupName ?? 'Không nhóm'}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] text-muted tabular-nums">
                      {onCount}/{ids.length}
                    </span>
                  </div>
                  {sec.items.map((p) => {
                    const on = picked.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggle(p.id)}
                        className="flex items-center py-2 pl-6 pr-2 rounded-lg hover:bg-[#101117] cursor-pointer select-none"
                      >
                        <span
                          className={
                            'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black shrink-0 ' +
                            (on ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')
                          }
                        >
                          {on ? <Icon name="check" filled size={14} className="inline align-[-3px]" /> : ''}
                        </span>
                        <span className={'ml-2.5 truncate ' + (on ? '' : 'text-subtle')}>{p.name}</span>
                        {p.proxyId && p.proxyId !== proxy.id && (
                          <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted">đang dùng proxy khác</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {filtered.length === 0 && <div className="text-muted text-[13px] px-2 py-3">Không có hồ sơ.</div>}
          </div>
        </div>
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
          <span className="text-[13px] text-muted">Đã chọn {picked.size}</span>
          <button
            onClick={onClose}
            className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]"
          >
            Hủy
          </button>
          <button
            onClick={apply}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px]"
          >
            Gán
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProxyTab({ onProfilesChanged }: { onProfilesChanged: () => void }): JSX.Element {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [machineIp, setMachineIp] = useState<MachineIp | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [assigning, setAssigning] = useState<Proxy | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)

  const reload = async (): Promise<void> => setProxies(await window.hnv.proxies.list())
  useEffect(() => {
    reload()
    window.hnv.system.machineIp().then(setMachineIp)
  }, [])

  // Proxy ảo đại diện IP máy thật — gán = xóa proxy khỏi profile. Không lưu DB.
  const machineProxy: Proxy = {
    id: MACHINE_PROXY_ID,
    type: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
    alive: null,
    ip: machineIp?.ip ?? null,
    country: machineIp?.country ?? null,
    countryCode: machineIp?.countryCode ?? null,
    ping: null,
    checkedAt: null,
    udpMs: null,
    quicOk: null,
    createdAt: 0,
    usedBy: 0,
  }

  const check = async (p: Proxy): Promise<void> => {
    setChecking(p.id)
    try {
      await window.hnv.proxies.check(p.id)
      await reload()
    } finally {
      setChecking(null)
    }
  }

  const checkAll = async (): Promise<void> => {
    setCheckingAll(true)
    for (const p of proxies) {
      setChecking(p.id)
      try {
        await window.hnv.proxies.check(p.id)
      } catch {
        /* ignore */
      }
    }
    setChecking(null)
    setCheckingAll(false)
    reload()
  }

  const remove = async (p: Proxy): Promise<void> => {
    if (
      !(await confirmDialog({
        title: 'Xóa proxy',
        message: `Xóa proxy ${p.host}:${p.port}?`,
        confirmText: 'Xóa',
      }))
    )
      return
    await window.hnv.proxies.remove(p.id)
    reload()
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-[22px] pt-[18px] pb-3.5 flex items-center gap-2.5">
        <div className="text-[21px] font-bold text-grad flex items-center gap-2">
          <Icon name="proxy" filled size={24} className="icon-grad" />
          Proxy
        </div>
        <span className="text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5 ml-1">
          {proxies.length} proxy
        </span>
        <button
          onClick={checkAll}
          disabled={checkingAll || proxies.length === 0}
          className="ml-auto font-semibold text-[14px] rounded-[10px] px-4 py-2.5 bg-surface border border-border text-[#c7c8d4] hover:border-[#3a3d6b] disabled:opacity-50"
        >
          {checkingAll ? (
            <>
              <Icon name="hourglass" filled size={15} className="inline align-[-3px] mr-1" />
              Đang check…
            </>
          ) : (
            <>
              <Icon name="bolt" filled size={15} className="inline align-[-3px] mr-1" />
              Check tất cả
            </>
          )}
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="accent-grad text-[#0a0b10] font-bold text-[14px] rounded-[10px] px-4 py-2.5"
        >
          + Thêm proxy
        </button>
      </div>

      <div className="flex-1 overflow-auto hv-scroll px-[22px] pb-3.5">
        {
          <table className="w-full text-[14px]" style={{ borderCollapse: 'separate', borderSpacing: '0 0' }}>
            <thead className="hv-th-grad">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold w-[44px] text-center">#</th>
                <th className="px-3 py-2.5 font-semibold">Proxy</th>
                <th className="px-3 py-2.5 font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 font-semibold">Dùng bởi</th>
                <th className="px-3 py-2.5 font-semibold">UDP / QUIC</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {/* Dòng cố định: IP máy thật — gán để đưa profile về không proxy */}
              <tr className="bg-[#0e0f15]">
                <td className="px-3 py-3 rounded-l-[10px] text-center">
                  <Icon name="monitor" filled size={16} className="inline align-[-3px]" />
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold">
                    IP máy thật <span className="text-muted font-normal">(không proxy)</span>
                  </div>
                  {machineIp?.ip && <div className="text-[12px] text-muted font-mono">{machineIp.ip}</div>}
                </td>
                <td className="px-3 py-3">
                  {machineIp ? (
                    <span>
                      <Flag code={machineIp.countryCode} w={20} /> <b>{machineIp.country}</b>
                    </span>
                  ) : (
                    <span className="text-muted">…</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="text-muted">—</span>
                </td>
                <td className="px-3 py-3">
                  <span className="text-muted">—</span>
                </td>
                <td className="px-3 py-3 rounded-r-[10px] text-right whitespace-nowrap">
                  <button
                    onClick={() => setAssigning(machineProxy)}
                    className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[13px] hover:border-[#3a3d6b]"
                  >
                    <Icon name="link" filled size={15} className="inline align-[-3px] mr-1" />
                    Gán
                  </button>
                </td>
              </tr>
              {proxies.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-5 text-muted text-center">
                    Chưa có proxy trong pool. Bấm <b className="text-accent2">+ Thêm proxy</b>.
                  </td>
                </tr>
              )}
              {proxies.map((p, i) => (
                <tr key={p.id} className={i % 2 === 0 ? 'bg-[#0e0f15]' : ''}>
                  <td className="px-3 py-3 rounded-l-[10px] text-center text-muted">{i + 1}</td>
                  <td className="px-3 py-3">
                    <div className="font-mono">
                      {p.type}://{p.host}:{p.port}
                    </div>
                    {p.username && <div className="text-[12px] text-muted">{p.username}:•••</div>}
                  </td>
                  <td className="px-3 py-3">
                    {checking === p.id ? (
                      <span className="text-muted">
                        <Icon name="hourglass" filled size={15} className="inline align-[-3px] mr-1" />
                        đang check…
                      </span>
                    ) : p.alive === null ? (
                      <span className="text-muted">○ chưa check</span>
                    ) : p.alive ? (
                      <span>
                        <Flag code={p.countryCode} w={20} /> <b>{p.country}</b>
                        <span className="text-subtle"> · {p.ping}ms</span>
                        <span className="text-ok ml-2">● Sống</span>
                      </span>
                    ) : (
                      <span className="text-danger">● Chết</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.usedBy > 0 ? (
                      <span className="text-accent2">{p.usedBy} profile</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.udpMs == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span>
                        <b className={p.quicOk ? 'text-ok' : 'text-muted'}>{p.quicOk ? 'QUIC' : 'TCP'}</b>{' '}
                        <span className="text-subtle">{p.udpMs} ms</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 rounded-r-[10px] text-right whitespace-nowrap">
                    <button
                      onClick={() => check(p)}
                      disabled={checking === p.id}
                      className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[13px] mr-1.5 hover:border-[#3a3d6b] disabled:opacity-40"
                    >
                      <Icon name="bolt" filled size={15} className="inline align-[-3px] mr-1" />
                      Check
                    </button>
                    <button
                      onClick={() => setAssigning(p)}
                      className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[13px] mr-1.5 hover:border-[#3a3d6b]"
                    >
                      <Icon name="link" filled size={15} className="inline align-[-3px] mr-1" />
                      Gán
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.10)] rounded-lg px-3 py-1.5 text-[13px]"
                    >
                      <Icon name="trash" filled size={16} className="inline align-[-3px]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>

      {showAdd && (
        <AddDialog
          onClose={() => setShowAdd(false)}
          onAdded={(n) => {
            setShowAdd(false)
            reload()
            showToast(`Đã thêm ${n} proxy (bỏ qua trùng).`, 'success')
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          proxy={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setAssigning(null)
            reload()
            onProfilesChanged() // cập nhật lại proxy hiển thị bên tab Hồ sơ
          }}
        />
      )}
    </div>
  )
}
