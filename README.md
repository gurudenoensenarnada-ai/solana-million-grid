# 🎨 Solana Million Grid

> A blockchain-powered pixel grid marketplace on Solana - Buy pixels, showcase your project!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-blueviolet)](https://solana.com)

## 📖 Descripción

**Solana Million Grid** es una aplicación Web3 inspirada en "The Million Dollar Homepage" que permite a usuarios comprar bloques de píxeles en un grid de 100x100 usando la blockchain de Solana. Cada compra queda registrada permanentemente en la blockchain.

### ✨ Características

- 🎯 **Grid Interactivo**: 10,000 bloques (100x100) disponibles para compra
- 💎 **Sistema de Zonas**: 3 niveles de precios (Oro, Plata, Bronce)
- 🔗 **Blockchain Real**: Transacciones verificadas en Solana mainnet
- 👛 **Wallet Integration**: Soporte para Phantom y otras wallets Solana
- 📱 **Notificaciones**: Alertas automáticas via Telegram
- ☁️ **Cloud Storage**: Persistencia en Cloudinary
- 🖼️ **Upload de Logos**: Sube y muestra tu logo/imagen
- 📊 **Stats en Tiempo Real**: Seguimiento de ventas y estadísticas

### 🎨 Sistema de Precios

| Zona | Filas | Color | Precio/Bloque |
|------|-------|-------|---------------|
| 🥇 ORO | 1-25 | Dorado | 1.0 SOL |
| 🥈 PLATA | 26-60 | Plateado | 0.5 SOL |
| 🥉 BRONCE | 61-100 | Bronce | 0.1 SOL |

*Precio especial para owner: 0.0001 SOL*

## 🚀 Inicio Rápido

### Prerequisitos

- Node.js >= 16.0.0
- npm >= 8.0.0
- Cuenta de Solana con fondos (para testing)
- (Opcional) Cuenta de Cloudinary
- (Opcional) Bot de Telegram

### Instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/gurudenoensenarnada-ai/solana-million-grid.git
cd solana-million-grid
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp .env.example .env
# Editar .env con tus valores reales
nano .env
```

4. **Configuración mínima requerida**
```env
MERCHANT_WALLET=tu_wallet_aqui
CLUSTER=mainnet-beta
RPC_URL=https://api.mainnet-beta.solana.com
```

5. **Iniciar el servidor**
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

6. **Abrir en el navegador**
```
http://localhost:3000
```

## 🛠️ Desarrollo

### Estructura del Proyecto

```
solana-million-grid/
├── src/
│   ├── server/           # Backend Node.js
│   │   ├── config/       # Configuración
│   │   ├── middleware/   # Express middleware
│   │   ├── routes/       # API routes
│   │   ├── controllers/  # Lógica de negocio
│   │   ├── services/     # Servicios externos
│   │   └── utils/        # Utilidades
│   └── client/           # Frontend
│       ├── index.html    # Página principal
│       ├── css/          # Estilos
│       └── js/           # JavaScript
├── tests/                # Tests
├── docs/                 # Documentación
├── uploads/              # Uploads temporales
└── .env.example          # Template de variables
```

### Scripts Disponibles

```bash
npm start        # Iniciar servidor producción
npm run dev      # Modo desarrollo con nodemon
npm test         # Ejecutar tests
npm run lint     # Linter
npm run format   # Formatear código con Prettier
```

### API Endpoints

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/config` | Obtener configuración |
| GET | `/api/sales` | Listar todas las ventas |
| POST | `/api/upload` | Subir imagen/logo |
| POST | `/api/purchase` | Registrar compra |
| GET | `/health` | Health check |

Ver [API Documentation](docs/API.md) para más detalles.

## 🔐 Seguridad

### ⚠️ IMPORTANTE

- ❌ **NUNCA** subas tu archivo `.env` a Git
- 🔄 Rota tus credenciales si fueron expuestas
- 🔒 Usa wallets de prueba para desarrollo
- 🛡️ Implementa rate limiting en producción
- ✅ Valida todas las transacciones en backend

### Buenas Prácticas

1. Usa `.env.example` como template
2. Mantén credenciales separadas por entorno
3. Usa servicios de secrets management en producción
4. Implementa monitoreo y alertas
5. Realiza auditorías de seguridad regulares

## 🌐 Deployment

### Render.com

1. Crear nuevo Web Service
2. Conectar repositorio
3. Configurar variables de entorno
4. Deploy!

```bash
# Build Command
npm install

# Start Command
npm start
```

### Variables de Entorno en Producción

Asegúrate de configurar TODAS las variables necesarias en tu plataforma de deployment:
- `MERCHANT_WALLET`
- `RPC_URL`
- `CLOUDINARY_*` (si usas Cloudinary)
- `TELEGRAM_*` (si usas notificaciones)

Ver [Deployment Guide](docs/DEPLOYMENT.md) para más detalles.

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Tests con coverage
npm run test:coverage

# Tests específicos
npm test -- --grep "API"
```

## 📚 Documentación

- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## 🤝 Contribuir

Las contribuciones son bienvenidas! Por favor lee [CONTRIBUTING.md](CONTRIBUTING.md) para detalles sobre nuestro código de conducta y el proceso para enviar pull requests.

### Proceso de Contribución

1. Fork el proyecto
2. Crea tu rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 👥 Autores

- **gurudenoensenarnada-ai** - *Trabajo inicial* - [GitHub](https://github.com/gurudenoensenarnada-ai)

## 🙏 Agradecimientos

- Inspirado en [The Million Dollar Homepage](http://www.milliondollarhomepage.com/)
- Construido sobre [Solana](https://solana.com)
- UI inspirada en diseños Web3 modernos

## 📞 Soporte

- 🐛 [Reportar Bugs](https://github.com/gurudenoensenarnada-ai/solana-million-grid/issues)
- 💬 [Discusiones](https://github.com/gurudenoensenarnada-ai/solana-million-grid/discussions)
- 📧 Email: [tu-email@ejemplo.com]

## 🗺️ Roadmap

- [ ] Soporte para más wallets (Solflare, Slope)
- [ ] Sistema de ofertas/subastas
- [ ] Marketplace secundario
- [ ] NFTs de los bloques comprados
- [ ] Analytics dashboard
- [ ] Mobile app
- [ ] Multi-idioma (i18n)

## ⚡ Performance

- Tiempo de carga: < 2s
- Confirmación de transacción: ~1-5s (depende de Solana)
- Uptime: 99.9%

## 🔗 Links Útiles

- [Solana Documentation](https://docs.solana.com/)
- [Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Phantom Wallet](https://phantom.app/)
- [Cloudinary Docs](https://cloudinary.com/documentation)

---

⭐ Si este proyecto te fue útil, considera darle una estrella en GitHub!

Made with ❤️ and ☕ by gurudenoensenarnada-ai
