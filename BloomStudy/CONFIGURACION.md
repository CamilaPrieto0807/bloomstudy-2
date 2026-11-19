# Configuración de BloomStudy

BloomStudy usa Firebase Authentication, Express, SQLite y correos SMTP para enviar recordatorios de tareas.

## Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/) y registra una aplicación web.
2. En **Authentication → Sign-in method**, habilita Google y agrega el dominio de la aplicación a **Authorized domains**.
3. Copia los valores web (`apiKey`, `authDomain`, `projectId` y `appId`) a `js/firebase-config.js`. Son configuración pública; no incluyas credenciales privadas en ese archivo.
4. Crea una clave privada de cuenta de servicio para el mismo proyecto. Configura la variable de entorno `FIREBASE_SERVICE_ACCOUNT` con el contenido JSON completo de esa credencial. No la guardes en el repositorio ni la expongas al navegador.

En PowerShell, puedes cargar temporalmente un archivo de credenciales protegido desde tu máquina:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content "C:\ruta\segura\service-account.json" -Raw
npm start
```

## Ejecución y almacenamiento

Desde la raíz del proyecto, instala dependencias con `npm install` y ejecuta `npm start`. La aplicación estará en `http://localhost:3000`; `PORT` permite cambiar el puerto y `DB_PATH` la ruta de SQLite (por defecto `./data/bloomstudy.db`).

En Render, el sistema de archivos del servicio puede ser temporal. Para conservar SQLite entre reinicios y despliegues, crea un **Persistent Disk**, móntalo en `/var/data` y configura `DB_PATH=/var/data/bloomstudy.db`. SQLite debe ejecutarse con una sola instancia del servicio. Si ya hay datos en el disco temporal, respáldalos y cópialos al disco persistente antes de cambiar `DB_PATH`; los datos no se trasladan solos.

Abre la aplicación mediante el servidor local, no con `file://`. En producción, sirve este servidor detrás de HTTPS.

## Recordatorios por correo

El servidor envía los recordatorios a la dirección verificada del token de Firebase del usuario. En Render, configura estas variables en **Environment**:

- `SMTP_HOST`: servidor SMTP (por ejemplo, `smtp.gmail.com`).
- `SMTP_PORT`: puerto SMTP (normalmente `587` para STARTTLS o `465` para TLS).
- `SMTP_SECURE`: `false` para el puerto 587; `true` para el 465.
- `SMTP_USER`: cuenta autorizada para enviar.
- `SMTP_PASS`: contraseña SMTP o contraseña de aplicación; nunca la subas a GitHub.
- `SMTP_FROM`: remitente permitido por el proveedor (opcional; por defecto `SMTP_USER`).

Con Gmail, usa una **contraseña de aplicación** de Google y mantén la verificación en dos pasos habilitada. Los correos se comprueban cada 30 segundos. Si SMTP no está configurado, la app informa que no se puede guardar una tarea con recordatorio.

Al guardar una tarea, el mensaje confirma que el correo quedó **programado**; no significa que ya fue enviado. Se envía cuando llega la hora elegida (por ejemplo, una hora antes de la entrega). Si no indicas hora de entrega, se toma 09:00 en la zona horaria del navegador. En los registros de Render busca `SMTP listo` o `No se pudo verificar SMTP`; también aparecerán ahí los errores de envío. La interfaz muestra el estado del correo debajo de la tarea. Revisa también Spam y Promociones.

El servicio debe estar activo para revisar la cola cada 30 segundos. Si el plan de Render suspende el servicio cuando está inactivo, el correo puede llegar tarde; para horarios confiables usa una instancia que permanezca activa. Para inspeccionar la cola en DB Browser for SQLite, abre la base de datos configurada en `DB_PATH` y ejecuta:

```sql
SELECT task_id, status,
       datetime(scheduled_at / 1000, 'unixepoch', 'localtime') AS programado,
       attempts, last_error
FROM task_reminders
ORDER BY scheduled_at DESC;
```

La API verifica el ID token de Firebase en cada solicitud y toma el UID del token verificado para aislar los datos. El perfil académico, tareas, historial de uso, preferencias de relajación y cola de recordatorios se guardan en SQLite; pueden usarse desde varios dispositivos si inician sesión en la misma cuenta.
