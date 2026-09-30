/** Domain schema for the demo water-treatment plant: mixins, enums, structs, abstract bases,
 * type definitions, unique/multi aspects, navigation and link-table relationships. */
export const WATER_PLANT_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<ECSchema schemaName="WaterPlant" alias="wp" version="01.00.00" displayLabel="Water Treatment Plant"
  description="Assets, process connectivity and operations data for a small water-treatment works."
  xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.2">
  <ECSchemaReference name="BisCore" version="01.00.00" alias="bis"/>
  <ECSchemaReference name="CoreCustomAttributes" version="01.00.00" alias="CoreCA"/>

  <ECEnumeration typeName="Service" backingTypeName="int" isStrict="true">
    <ECEnumerator name="RawWater" value="0" displayLabel="Raw water"/>
    <ECEnumerator name="Settled" value="1" displayLabel="Settled water"/>
    <ECEnumerator name="Filtered" value="2" displayLabel="Filtered water"/>
    <ECEnumerator name="Treated" value="3" displayLabel="Treated water"/>
    <ECEnumerator name="Chemical" value="4" displayLabel="Chemical"/>
    <ECEnumerator name="Sludge" value="5" displayLabel="Sludge"/>
  </ECEnumeration>
  <ECEnumeration typeName="Criticality" backingTypeName="int" isStrict="true">
    <ECEnumerator name="Low" value="1" displayLabel="Low"/>
    <ECEnumerator name="Medium" value="2" displayLabel="Medium"/>
    <ECEnumerator name="High" value="3" displayLabel="High"/>
  </ECEnumeration>
  <ECEnumeration typeName="WorkOrderStatus" backingTypeName="string" isStrict="true">
    <ECEnumerator name="Open" value="Open" displayLabel="Open"/>
    <ECEnumerator name="InProgress" value="InProgress" displayLabel="In progress"/>
    <ECEnumerator name="Closed" value="Closed" displayLabel="Closed"/>
  </ECEnumeration>

  <ECStructClass typeName="DutyPoint" description="Design operating point of a pump.">
    <ECProperty propertyName="Flow" typeName="double" description="L/s"/>
    <ECProperty propertyName="Head" typeName="double" description="m"/>
  </ECStructClass>

  <ECEntityClass typeName="IMaintainable" modifier="Abstract" description="Asset maintained on a schedule.">
    <ECCustomAttributes>
      <IsMixin xmlns="CoreCustomAttributes.01.00.00"><AppliesToEntityClass>bis:PhysicalElement</AppliesToEntityClass></IsMixin>
    </ECCustomAttributes>
    <ECProperty propertyName="Criticality" typeName="Criticality"/>
    <ECProperty propertyName="MaintenanceIntervalDays" typeName="int"/>
  </ECEntityClass>

  <ECEntityClass typeName="Equipment" modifier="Abstract">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="Tag" typeName="string"/>
    <ECProperty propertyName="Description" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="Pump">
    <BaseClass>Equipment</BaseClass>
    <BaseClass>IMaintainable</BaseClass>
    <ECStructProperty propertyName="DutyPoint" typeName="DutyPoint"/>
  </ECEntityClass>
  <ECEntityClass typeName="Motor">
    <BaseClass>Equipment</BaseClass>
    <BaseClass>IMaintainable</BaseClass>
    <ECProperty propertyName="PowerKw" typeName="double"/>
    <ECProperty propertyName="Voltage" typeName="int"/>
  </ECEntityClass>
  <ECEntityClass typeName="Tank">
    <BaseClass>Equipment</BaseClass>
    <ECProperty propertyName="Capacity" typeName="double" description="m3"/>
    <ECProperty propertyName="Diameter" typeName="double" description="m"/>
    <ECProperty propertyName="Height" typeName="double" description="m"/>
  </ECEntityClass>
  <ECEntityClass typeName="Clarifier">
    <BaseClass>Tank</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="FilterBasin">
    <BaseClass>Equipment</BaseClass>
    <BaseClass>IMaintainable</BaseClass>
    <ECProperty propertyName="MediaType" typeName="string"/>
    <ECProperty propertyName="Area" typeName="double" description="m2"/>
  </ECEntityClass>
  <ECEntityClass typeName="Header">
    <BaseClass>Equipment</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="ControlPanel">
    <BaseClass>Equipment</BaseClass>
    <ECProperty propertyName="Voltage" typeName="int"/>
  </ECEntityClass>
  <ECEntityClass typeName="Instrument" modifier="Abstract">
    <BaseClass>Equipment</BaseClass>
    <ECProperty propertyName="MeasuredVariable" typeName="string"/>
    <ECProperty propertyName="RangeMax" typeName="double"/>
    <ECProperty propertyName="Units" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="FlowMeter">
    <BaseClass>Instrument</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="LevelTransmitter">
    <BaseClass>Instrument</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="Pipe">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="Tag" typeName="string"/>
    <ECProperty propertyName="Service" typeName="Service"/>
    <ECProperty propertyName="NominalDiameter" typeName="int" description="mm"/>
    <ECProperty propertyName="Length" typeName="double" description="m"/>
    <ECNavigationProperty propertyName="FromEquipment" relationshipName="PipeRunsFromEquipment" direction="Backward"/>
    <ECNavigationProperty propertyName="ToEquipment" relationshipName="PipeRunsToEquipment" direction="Backward"/>
  </ECEntityClass>
  <ECEntityClass typeName="Valve">
    <BaseClass>Equipment</BaseClass>
    <BaseClass>IMaintainable</BaseClass>
    <ECProperty propertyName="NormallyOpen" typeName="boolean"/>
    <ECNavigationProperty propertyName="InstalledOn" relationshipName="PipeHasInlineValves" direction="Backward"/>
  </ECEntityClass>
  <ECEntityClass typeName="Building">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="Use" typeName="string"/>
    <ECProperty propertyName="FloorArea" typeName="double" description="m2"/>
  </ECEntityClass>
  <ECEntityClass typeName="BuildingComponent">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="ComponentKind" typeName="string"/>
    <ECProperty propertyName="Material" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="SiteFeature">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="FeatureKind" typeName="string"/>
  </ECEntityClass>

  <ECEntityClass typeName="PumpType">
    <BaseClass>bis:PhysicalType</BaseClass>
    <ECProperty propertyName="Manufacturer" typeName="string"/>
    <ECProperty propertyName="ModelNumber" typeName="string"/>
    <ECProperty propertyName="RatedFlow" typeName="double" description="L/s"/>
    <ECProperty propertyName="RatedPowerKw" typeName="double"/>
  </ECEntityClass>
  <ECEntityClass typeName="ValveType">
    <BaseClass>bis:PhysicalType</BaseClass>
    <ECProperty propertyName="Manufacturer" typeName="string"/>
    <ECProperty propertyName="ModelNumber" typeName="string"/>
    <ECProperty propertyName="PressureClass" typeName="string"/>
  </ECEntityClass>

  <ECEntityClass typeName="ProcessArea">
    <BaseClass>bis:SpatialLocationElement</BaseClass>
    <ECProperty propertyName="AreaCode" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="Train" description="Equipment operated together.">
    <BaseClass>bis:GroupInformationElement</BaseClass>
    <ECProperty propertyName="DesignCapacity" typeName="double" description="ML/d"/>
  </ECEntityClass>
  <ECEntityClass typeName="OperationsModel">
    <BaseClass>bis:GroupInformationModel</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="WorkOrder">
    <BaseClass>bis:InformationRecordElement</BaseClass>
    <ECProperty propertyName="Number" typeName="string"/>
    <ECProperty propertyName="Summary" typeName="string"/>
    <ECProperty propertyName="Status" typeName="WorkOrderStatus"/>
    <ECProperty propertyName="Priority" typeName="Criticality"/>
    <ECProperty propertyName="DueDate" typeName="dateTime"/>
  </ECEntityClass>

  <ECEntityClass typeName="Nameplate">
    <BaseClass>bis:ElementUniqueAspect</BaseClass>
    <ECProperty propertyName="Manufacturer" typeName="string"/>
    <ECProperty propertyName="SerialNumber" typeName="string"/>
    <ECProperty propertyName="YearInstalled" typeName="int"/>
  </ECEntityClass>
  <ECEntityClass typeName="Inspection">
    <BaseClass>bis:ElementMultiAspect</BaseClass>
    <ECProperty propertyName="InspectedOn" typeName="dateTime"/>
    <ECProperty propertyName="Inspector" typeName="string"/>
    <ECProperty propertyName="Condition" typeName="string"/>
  </ECEntityClass>

  <ECRelationshipClass typeName="PipeRunsFromEquipment" strength="referencing" modifier="Sealed">
    <Source multiplicity="(0..1)" roleLabel="discharges into" polymorphic="true"><Class class="Equipment"/></Source>
    <Target multiplicity="(0..*)" roleLabel="runs from" polymorphic="true"><Class class="Pipe"/></Target>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="PipeRunsToEquipment" strength="referencing" modifier="Sealed">
    <Source multiplicity="(0..1)" roleLabel="is supplied by" polymorphic="true"><Class class="Equipment"/></Source>
    <Target multiplicity="(0..*)" roleLabel="runs to" polymorphic="true"><Class class="Pipe"/></Target>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="PipeHasInlineValves" strength="referencing" modifier="Sealed">
    <Source multiplicity="(0..1)" roleLabel="has inline" polymorphic="true"><Class class="Pipe"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is installed on" polymorphic="true"><Class class="Valve"/></Target>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="ProcessFeeds" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="feeds" polymorphic="true"><Class class="Equipment"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is fed by" polymorphic="true"><Class class="Equipment"/></Target>
    <ECProperty propertyName="Service" typeName="Service"/>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="MotorDrivesPump" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="drives" polymorphic="true"><Class class="Motor"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is driven by" polymorphic="true"><Class class="Pump"/></Target>
    <ECProperty propertyName="Coupling" typeName="string"/>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="PanelPowersEquipment" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="powers" polymorphic="true"><Class class="ControlPanel"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is powered by" polymorphic="true"><Class class="Equipment"/></Target>
    <ECProperty propertyName="Circuit" typeName="string"/>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="InstrumentMonitors" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="monitors" polymorphic="true"><Class class="Instrument"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is monitored by" polymorphic="true"><Class class="bis:PhysicalElement"/></Target>
    <ECProperty propertyName="AlarmHigh" typeName="double"/>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="AreaIncludesElements" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="includes" polymorphic="true"><Class class="ProcessArea"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is located in" polymorphic="true"><Class class="bis:PhysicalElement"/></Target>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="WorkOrderTargetsAsset" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="targets" polymorphic="true"><Class class="WorkOrder"/></Source>
    <Target multiplicity="(0..*)" roleLabel="has work order" polymorphic="true"><Class class="bis:PhysicalElement"/></Target>
  </ECRelationshipClass>
</ECSchema>`;
