# Configuración de BloomStudy

BloomStudy usa Firebase Authentication para iniciar sesión, Express para la API y SQLite para persistir datos por cuenta.

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

Abre la aplicación mediante el servidor local, no con `file://`. En producción, sirve este servidor detrás de HTTPS.

La API verifica el ID token de Firebase en cada solicitud y toma el UID del token verificado para aislar los datos. El perfil académico, tareas, historial de uso y método de relajación elegido se guardan en SQLite; pueden usarse desde varios dispositivos siempre que inicien sesión en la misma cuenta.
