import { roles } from '../../domain/prompt/roles'

export function RolesPage() {
  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">LIBRARY / ROLES</p>
          <h1>Engineering modes.</h1>
          <p className="lede">A role is more than a title. It defines responsibilities, rules, constraints, and expected output.</p>
        </div>
      </header>
      <div className="roles-grid">
        {roles.map((role) => (
          <article className="role-card" key={role.id}>
            <div className="role-index">{role.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</div>
            <h2>{role.name}</h2>
            <p>{role.description}</p>
            <div className="tag-row">{role.responsibilities.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>
          </article>
        ))}
      </div>
    </section>
  )
}