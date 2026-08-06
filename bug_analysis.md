# تحليل المشاكل

## المشكلة الرئيسية: عدم وصول بيانات البطاقة إلى لوحة Admin

### سبب 1 (الأخطر): `knetPayBtn` غير مربوط بأي حدث
- عند اختيار Knet، يتم إخفاء `payBtn` (السطر 772) وإظهار `knetCardSection`
- لكن `knetPayBtn` (السطر 694) غير مربوط بأي event listener
- `payBtn` مربوط بـ click handler (السطر 782-792) لكنه مخفي عند اختيار Knet
- النتيجة: المستخدم لا يمكنه إرسال بيانات Knet من الصفحة الأب

### سبب 2: زر "إرسال" داخل iframe Knet يعمل بشكل مستقل
- زر "إرسال" داخل knet.html (السطر 331-335) يستدعي `window.onPay()`
- `onPay` في knet.html يقوم بإرسال البيانات مباشرة (السطر 338-379)
- لكن: `knet.html` يبحث عن orderId في localStorage أو sessionStorage (السطر 351)
- المشكلة: `data.html` يخزن orderId فقط في sessionStorage (السطر 1094)
- `index.html` يخزن orderId فقط في sessionStorage عند CTA click

### سبب 3: knet.html يقرأ orderId من localStorage (لا sessionStorage فقط)
- السطر 351: `var orderId = localStorage.getItem('orderId') || sessionStorage.getItem('orderId');`
- في knet.html (الإطار الداخلي)، sessionStorage قد لا يكون متاحاً بشكل صحيح لأن:
  - knet.html محمّل كـ iframe داخل payment.html
  - iframe يشارك نفس origin فـ sessionStorage يجب أن يكون متاحاً
  - لكن قد يكون هناك مشكلة في التوقيت أو الحالة

### سبب 4: credit card - `payment_method` غير متسق
- payment.html (عربي) يرسل `payment_method: 'Credit'` (السطر 1300)
- payment-en.html (إنجليزي) لا يرسل `payment_method` أبداً
- server.js يتحقق من `payment_method === 'Knet'` (السطر 511)
- أي قيمة أخرى تعتبر Credit Card (هذا يعمل لكن غير متسق)

### المشكلة الحقيقية الرئيسية:
**عند اختيار Knet في payment.html:**
1. `payBtn` يختفي (display: none) عند اختيار Knet
2. `knetPayBtn` لا يوجد له أي event listener
3. المستخدم يعتمد على زر "إرسال" داخل iframe Knet فقط
4. iframe Knet (knet.html) يقرأ orderId من localStorage.getItem('orderId') أولاً
5. لكن orderId مخزن فقط في sessionStorage وليس localStorage
6. localStorage.getItem('orderId') = null → sessionStorage.getItem('orderId') = قد يعمل
7. لكن المشكلة الأكبر: knet.html كـ iframe قد لا يملك نفس access للـ sessionStorage بشكل موثوق

**الحل:**
1. ربط `knetPayBtn` بحدث click يرسل postMessage للـ iframe
2. تخزين orderId في localStorage أيضاً (بالإضافة لـ sessionStorage)
3. أو: payment.html يقرأ orderId من sessionStorage ويرسله للـ iframe عند التحميل
4. التأكد من أن Knet bridge يعمل بشكل صحيح

### المشكلة الثانية: order_state لا يتحدث بشكل صحيح
- عند إرسال payment-data، server.js يحدث order_states إلى stage='payment', status='pending'
- لكن إذا orderId غير موجود أو خاطئ، يرجع 404 ولا يتم التحديث
- في هذه الحالة، order_state تبقى على 'waiting' ولا تظهر بيانات الدفع في admin
