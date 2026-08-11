// Gắn icon + thông tin phiên bản vào HienNVAuto.exe NGAY SAU khi electron-builder
// pack xong thư mục app, TRƯỚC khi nó đóng gói thành installer.
//
// Trước đây `npm run dist` gọi scripts/set-exe-icon.ps1 ở bước cuối. Với target
// `dir` thì đúng — thư mục win-unpacked chính là sản phẩm cuối. Với `nsis` thì
// SAI: electron-builder pack thư mục rồi đóng gói installer ngay trong cùng một
// lệnh, nên khi script chạy thì installer đã ôm sẵn bản .exe chưa có icon. Hook
// này chạy đúng khe giữa hai bước đó.
const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (process.platform !== 'win32') return
  const script = join(context.packager.projectDir, 'scripts', 'set-exe-icon.ps1')
  execFileSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', script, '-AppDir', context.appOutDir],
    { stdio: 'inherit' }
  )
}
