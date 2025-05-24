require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ======================
// 1. KONFIGURASI AWAL
// ======================
const app = express();
const PORT = process.env.PORT || 3000;
const NOMOR_ADMIN = process.env.ADMIN_PHONE || '6282314030667'; // Nomor admin default

// Konfigurasi untuk Railway atau lokal
const isProduction = process.env.NODE_ENV === 'production';
const PATH_DATABASE = isProduction ? '/data/database.xlsx' : path.join(__dirname, 'database.xlsx');
const PATH_SESSION = isProduction ? '/data/session' : './session-data';

// Buat folder session jika belum ada
if (!fs.existsSync(PATH_SESSION)) {
  fs.mkdirSync(PATH_SESSION, { recursive: true });
}

// ======================
// 2. FUNGSI DATABASE
// ======================
function bacaDatabase() {
  try {
    const workbook = XLSX.readFile(PATH_DATABASE);
    return {
      users: XLSX.utils.sheet_to_json(workbook.Sheets['users']),
      vouchers: XLSX.utils.sheet_to_json(workbook.Sheets['vouchers'])
    };
  } catch (error) {
    console.error('Gagal membaca database:', error);
    return { users: [], vouchers: [] };
  }
}

function updateDatabase(data) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.users), 'users');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.vouchers), 'vouchers');
  XLSX.writeFile(workbook, PATH_DATABASE);
}

// ======================
// 3. KONFIGURASI CLIENT WHATSAPP
// ======================
const client = new Client({
  puppeteer: {
    headless: "new",  // Mode baru Puppeteer
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
});

// ======================
// 4. EVENT HANDLER
// ======================
const QRCode = require('qrcode');


client.on('qr', async qr => {
  // Simpan QR sebagai gambar
  await QRCode.toFile('/tmp/whatsapp-qr.png', qr, {
    width: 500,
    margin: 2
  });
  
  console.log("✅ QR Code tersimpan di /tmp/whatsapp-qr.png");
  console.log("📲 Scan QR Code berikut:");
});
client.on('ready', () => {
  console.log('🤖 Bot siap digunakan!');
  console.log(`Nomor Admin: ${NOMOR_ADMIN}`);
});

client.on('disconnected', (reason) => {
  console.log('⚠️ Koneksi terputus:', reason);
  console.log('🔄 Mencoba menyambung kembali...');
  setTimeout(() => client.initialize(), 5000);
});

client.on('message', async pesan => {
  try {
    const { users, vouchers } = bacaDatabase();
    const pengirim = pesan.from.split('@')[0];
    const user = users.find(u => u.phone === pengirim);
    const isAdmin = pengirim === NOMOR_ADMIN;

    // Perintah khusus admin
    if (isAdmin) {
      // Tambah user baru: !tambahuser [nomor] [nama]
      if (pesan.body.toLowerCase().startsWith('!tambahuser ')) {
        const [, nomor, nama] = pesan.body.split(' ');
        
        // Validasi nomor
        if (!nomor.startsWith('62')) {
          return pesan.reply('❌ Format nomor salah. Gunakan 62xxxxxxxxxx');
        }

        // Cek apakah user sudah ada
        if (users.some(u => u.phone === nomor)) {
          return pesan.reply('❌ User sudah terdaftar');
        }

        const userBaru = {
          phone: nomor,
          name: nama,
          userId: `U${Date.now().toString().slice(-4)}`,
          isAdmin: false,
          registeredDate: new Date().toISOString().split('T')[0]
        };
        
        users.push(userBaru);
        updateDatabase({ users, vouchers });
        return pesan.reply(`✅ User ${nama} (${nomor}) berhasil ditambahkan!`);
      }

      // Tambah voucher baru: !tambahvoucher [kode] [nilai] [expiry]
      if (pesan.body.toLowerCase().startsWith('!tambahvoucher ')) {
        const [, kode, nilai, expiry] = pesan.body.split(' ');
        
        if (vouchers.some(v => v.code === kode)) {
          return pesan.reply('❌ Kode voucher sudah ada');
        }

        const voucherBaru = {
          code: kode.toUpperCase(),
          value: nilai,
          expiry: expiry,
          userId: null,
          redeemed: false,
          createdDate: new Date().toISOString().split('T')[0]
        };
        
        vouchers.push(voucherBaru);
        updateDatabase({ users, vouchers });
        return pesan.reply(`✅ Voucher ${kode.toUpperCase()} berhasil dibuat!\nNilai: ${nilai}\nExpiry: ${expiry}`);
      }
    }

    // Perintah untuk semua user
    if (!user && !isAdmin) {
      return pesan.reply('❌ Anda belum terdaftar. Hubungi admin untuk mendaftar.');
    }

    // Lihat voucher: 'voucher'
    if (pesan.body.toLowerCase() === 'voucher') {
      const voucherUser = vouchers.filter(v => 
        v.userId === user?.userId && !v.redeemed
      );

      if (voucherUser.length === 0) {
        return pesan.reply('📭 Anda tidak memiliki voucher aktif.');
      }

      let balasan = '🎟️ *DAFTAR VOUCHER ANDA(silahkan pilih salah satu)*\n\n';
      voucherUser.forEach(v => {
        balasan += `➤ *${v.code}*: ${v.value}\n`;
        balasan += `   📅 Berlaku hingga: ${v.expiry}\n\n`;
      });
      balasan += 'Ketik *redeem KODE_VOUCHER* untuk menukarkan.';
      return pesan.reply(balasan);
    }

    // Tukar voucher: 'redeem KODE'
    if (pesan.body.toLowerCase().startsWith('redeem ')) {
      const kodeVoucher = pesan.body.split(' ')[1].toUpperCase();
      const voucher = vouchers.find(v => 
        v.code === kodeVoucher && 
        v.userId === user.userId &&
        !v.redeemed
      );

      if (!voucher) {
        return pesan.reply('❌ Voucher tidak valid/sudah digunakan.');
      }

      // Update status voucher
      const voucherIndex = vouchers.findIndex(v => v.code === kodeVoucher);
      vouchers[voucherIndex] = { 
        ...vouchers[voucherIndex], 
        redeemed: true,
        redeemedDate: new Date().toISOString().split('T')[0]
      };
      
      updateDatabase({ users, vouchers });

      return pesan.reply(
        `✅ *Voucher berhasil ditukarkan!*\n\n` +
        `🎉 ${voucher.value}\n` +
        `🛒 Kode redeem: *${generateKodeAcak()}*\n` +
        `📅 Berlaku hingga: ${voucher.expiry}`
      );
    }
  } catch (error) {
    console.error('Error:', error);
    pesan.reply('⚠️ Terjadi kesalahan. Silakan coba lagi.');
  }
});

// ======================
// 5. FUNGSI PENDUKUNG
// ======================
function generateKodeAcak() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ======================
// 6. INISIALISASI SERVER
// ======================
client.initialize();

app.get('/', (req, res) => {
  res.send('WhatsApp Voucher Bot aktif!');
});

app.listen(PORT, () => {
  console.log(`🌐 Server berjalan di port ${PORT}`);
});

// Auto-reconnect setiap 6 jam
setInterval(() => {
  if (!client.pupPage || client.pupPage.isClosed()) {
    console.log('🔄 Auto-reconnect...');
    client.initialize();
  }
}, 6 * 60 * 60 * 1000);