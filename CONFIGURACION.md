# Configuración de acceso con Google

BloomStudy es una aplicación web adaptable a móviles (HTML, CSS y JavaScript); no es un proyecto Flutter. La autenticación se realiza con Firebase Authentication y Google. Para activarla:

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/) y registra una aplicación web.
2. En **Authentication → Sign-in method**, habilita **Google**.
3. Copia la configuración de la aplicación web en `js/firebase-config.js` (`apiKey`, `authDomain`, `projectId` y `appId`). La configuración web de Firebase no es una clave privada; no agregues secretos al navegador.
4. En **Authentication → Settings → Authorized domains**, agrega el dominio donde publicarás la app. Para desarrollo, sirve la carpeta con un servidor local HTTP; no abras `index.html` con `file://`.
5. Publica la carpeta `BloomStudy` en un hosting HTTPS y prueba el ingreso tanto en escritorio como en un móvil.

Al ingresar por primera vez, Google autentica la cuenta y BloomStudy solicita nombres, código estudiantil, carrera, universidad y semestre. Los inicios posteriores reconocen el perfil de esa cuenta en el mismo navegador.

**Almacenamiento actual:** Firebase verifica la autenticación; el perfil académico, las tareas y el historial de uso se guardan en el almacenamiento local del navegador y se separan por cuenta. No se sincronizan entre dispositivos ni navegadores.
